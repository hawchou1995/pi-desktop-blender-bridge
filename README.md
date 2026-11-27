# PI Blender Bridge（候选，未发布）

PI-Desktop 侧的 Blender 桥接：把 [dsh-blender-plugin](https://github.com/sixtysevenlf/dsh-blender-plugin)
3.1.0-alpha.1 的**运行时、协议、算子与 skill**原样搬过来，只替换最薄的一层宿主适配。

- 上游固定提交：`6c5614712972a5cbca52b13d4df9193d76e76b0d`（main，2026-11-11，3.1.0-alpha.1）
- 插件 id：`io.github.hawchou1995.pi-desktop-blender-bridge`，版本 `3.1.5`
- 宿主：PI-Desktop 0.23.0（`engines.piDesktop >= 0.23.0`）
- 本仓库**不 push、不发版、不装进用户日常配置**；产物仅在本地 `dist/`

## 1. 它是什么 / 不是什么

**复用（未改写）**

| 部分 | 位置 | 许可 |
|---|---|---|
| Gateway（29 条 HTTP 路由 + `/addon` WebSocket + 会话注册 + lease/scope/txn + 有界作业队列 + headless 执行器） | `vendor/source/runtime/**` → `vendor/dsh-runtime/lib/runtime/**`（tsc 构建） | BSD-3-Clause |
| 34 family / 228 op 的算子目录与 Python 实现（`runtime/py/**`，含 surface_*、asm_*、img_*、gate_* 等） | `vendor/dsh-runtime/runtime/py/**` | BSD-3-Clause |
| Blender addon（protocol 12，25 条注册命令 / 26 wire） | `vendor/source/extension/**` → `addon/dsh_blender_bridge-2.0.0.zip`（Blender 5.3 官方扩展构建） | GPL-3.0-or-later |
| 建模 skill `blender-modeling` | `skills/blender-modeling/SKILL.md`（随包注册给 Skill 工具） | MIT |

**新写（薄适配，全部是本项目文件）**

- `manifest.json` / `main.js`：PI 插件清单与 `onLoad`/`onUnload` 生命周期。
- `bridge/gateway-entry.mjs`：启动上游 Gateway，只加三件事——每轮一次性 token、`/addon` 只接受 loopback 且拒绝浏览器 Origin、结构化就绪/失败输出。
- `bridge/proc.cjs`：Gateway 子进程托管（PI 无「任意进程」API，插件自己的 Node 进程负责拉起与停止；不下载、不提权）。
- `bridge/client.cjs`：loopback HTTP 客户端（保留上游 `x-dsh-*` caller 头与 lease `holder`，附 token）。
- `bridge/tools.cjs`：六个工具在 PI 的 `pi.agent.registerTool` 上的注册与参数映射（路由、动作、参数契约照上游）。
- `panel/index.html`：状态/诊断面板（Gateway 状态、doctor、启停、日志尾部、addon zip 路径）。
- `scripts/*`、`tests/*`：构建、哈希锁定、验证。

**没有重写**：228 个算子、Python 内核、作业队列、addon 协议、addon 源码。

## 2. 依赖（明示，无运行时下载）

| 依赖 | 要求 | 说明 |
|---|---|---|
| PI-Desktop | 0.23.0（`>=0.23.0`） | 插件宿主 |
| Node | **>= 24.9**（最低可跑 22） | Gateway 是 Node 进程。优先用 PI-Desktop 自带的 Node（`ELECTRON_RUN_AS_NODE`），其次是 PATH 上的 `node`，也可在设置里指定 `nodePath`。上游 `engines` 写的是 `>=24.9.0` |
| Blender | 4.2+；本机实测 **5.3.0**（Steam 版） | addon `blender_version_min = "4.2.0"`。上游 README 只验证到 4.2 LTS，5.x 上游未验证——本项目在 5.3 实测了扩展安装、构建与 headless 渲染 |
| 网络 | 不需要 | 没有任何运行时下载；构建需要 npm 拉 typescript/@types/node（仅 devDependency） |

与既有 `blender-mcp` 的关系：**互不影响**。端口用 39877（Gateway，loopback），`blender-mcp` 用 9876；插件 id 不同；本插件不停止、不禁用、不改动任何既有 addon 或进程。

## 3. 安装（本地候选）

1. 构建（见第 6 节），得到 `dist/io.github.hawchou1995.pi-desktop-blender-bridge-3.1.5.piplug`。
2. PI-Desktop → Plugins → 手动安装该 `.piplug`（或「Load development plugin」指向本目录）。
3. 授权三项权限：`agent.tool.register`、`agent.prompt.inject`、`ui.panel`。
4. **配对（只需一次）**：命令面板运行「Blender Bridge: 复制配对码」（或打开诊断面板复制）。这个码是 addon 连接 Gateway 的共享秘密。
5. Blender 侧：Edit → Preferences → Extensions → 右上角下拉 `Install from Disk…` 选 `addon/dsh_blender_bridge-2.0.0.zip`（或命令「Blender Bridge: 复制 addon zip 路径」取路径）。启用扩展后，在偏好设置 → 扩展 → DSH Blender Bridge → **Gateway Pairing Code** 粘贴配对码（也可用环境变量 `DSHBB_GATEWAY_TOKEN` 给 Blender 进程），再在 3D 视图 N 面板点 **Connect**。配对码保存在 Blender 偏好里，重连沿用。
6. 轮换配对码：「Blender Bridge: 轮换配对码」→ Gateway 重启并生成新码；Blender 侧改成新码后重连。
7. 端口对齐：插件设置 `gatewayPort`（默认 39877）= Blender addon 偏好里的 Gateway Port（默认同为 39877）。改端口时两边都要改，或给 Blender 进程设 `DSHBB_GATEWAY_PORT`。
8. 验证：命令「Blender Bridge: 状态」→ 面板 Doctor → `addon=ok` / `ready=true`。若被拒：确认 addon 的 Pairing Code 与面板一致，再看面板「日志尾部」。

## 4. 六个工具（与上游同名同参）

| 工具 | 走的上游路由 | 说明 |
|---|---|---|
| `blender_session` | `POST /lease`（list/attach/claim/grant/revoke/pause/…）、`GET /status`、`GET /doctor`、`POST /txn` | 会话、归属、写 scope、pause、事务快照 |
 | `blender_op` | `POST /plan`、`/loop`、`/opt`、`/preset` | 34 family / 228 op 主入口；只读 op（98 个，由构建期从 `runtime/catalog/data.ts` 生成）与 `action=help` 不需要会话；写算子（含 `args.dry_run=true`）、`loop(target=gui)`、`opt`、`preset` 都需要 ready 的 GUI 会话 |
| `blender_py` | `POST /act`（+ 可选 `GET /frame.png`） | GUI 会话内 Python（持久内核 K），仅 GUI，无 headless 回退 |
| `blender_see` | `GET /frame.png`、`POST /view` | viewport / camera / custom、单帧或序列，固定档位 |
| `blender_run` | `POST /job`（`surface=queue`）、`POST /perf` | 唯一作业入口：render / headless，submit→status/wait/collect/cancel/list |
| `blender_inspect` | `GET /commands`、`POST /cmd` | 只读命令目录与执行；写/下载/内部传输命令返回 `wrong_tool` |

 `op=catalog` 与 `doctor.kind` 都是上游真实值：本机验证 `families=34`、`opsCount=228`、`commandCatalogKeys=25`、`toolDetailKeys=6`。

**会话契约（与 Gateway 真实行为一致）**：算子都在 Blender 进程里执行，所以只要不是宿主侧就能判定的只读 op，就必须有 ready 的 GUI 会话。`args.dry_run=true` 只让算子跳过落盘/写入，**不豁免会话**——Gateway 的 `/plan` 虽然对只读 op 不施加 leaseGate，但算子本身仍需已连接的 addon 才能跑；本适配层因此在 `/plan` 之前就显式返回 `session_required` 并给 attach/start 选项，与只读路径的报错风格一致。上游 `src/tools/op/execute.ts` 对所有 `loop(gui)`/`opt`/`preset` 一律加会话门，唯一例外是 `loop target=session`（持久无头 worker），故本适配层同样放行该分支。

### 与 DSH 宿主面的差异（如实列出，不声称全量）

| DSH 能力 | 本适配的等价面 | 状态 |
|---|---|---|
| TUI 选中 chip / 页脚状态 | PI 命令面板命令 + 诊断面板（状态、doctor、日志、启停） | 已提供，形态不同 |
| `@` 提及 Blender 会话 | PI 插件无此等价面（composerTrigger 槽未接入） | **未提供** |
| `/blender` 快捷命令 | PI 命令面板 4 条命令（status/open-panel/restart/addon-path） | 已提供，无 slash 语法 |
| DSH 卡片渲染（`renderOne`/presenters） | 工具返回结构化 JSON + 一行摘要 + `text` 字段 | **未移植**卡片样式 |
| DSH 工具错误信封（stage/root_cause/fix/evidence） | `{ok:false, code, text, fix, stage?, evidence?}` | 字段等价，未逐字对齐 |
| 图像附件通道（`toAttachment`） | PNG 落盘到插件数据目录 `frames/`，返回绝对路径 + sha256 + 尺寸 | 形态不同（PI 插件工具不回传二进制图片内容） |
| virtual-gui（Windows hidden-desktop） | 上游 helper 二进制不在本包内（上游 3.1 未随 npm 包发布该 exe），doctor 会报 `win-hidden-desktop-helper` 缺失 | **不可用**；user-gui（真实 Blender + Connect）可用 |
| Linux xvfb / pkexec 一键安装 | 未接入（本机 Windows） | **未验证** |

## 5. 安全边界

- **只绑 loopback**：Gateway `host` 固定 `127.0.0.1`，绑定后再校验 `server.address()` 是 loopback，否则退出。
- **每个生命周期一次性 token**：`bridge/gateway-entry.mjs` 在 HTTP 请求前置检查 `x-pi-bridge-token`（sha256 + `timingSafeEqual`），不匹配返回 `403 bridge_token_required`。上游没有任何 HTTP 鉴权，因此匿名本地进程原本可以直接打 `/act` 执行 Python；这一层把它挡掉。实测匿名请求 `403`。
- **`/addon` 配对**：升级请求必须同时满足 loopback、无浏览器 `Origin`、并携带 `x-dsh-bridge-token` 配对码；缺失/错误一律 403（同一不透明响应，不给出哪个校验失败的预言机）。配对码由插件生成后存本插件数据目录（`pairing.json`，0600 尽力而为），只在面板/命令里显示，不写入设置、日志或工具返回；addon 侧保存在偏好（PASSWORD 字段）或用 `DSHBB_GATEWAY_TOKEN`。addon 的改动是唯一一处源 delta，见 `patches/addon-pairing-token.mjs` 与 `NOTICE`。
- **Python 执行面**：`blender_py` 与 `blender_run(kind=headless)` 是设计上的本地代码执行面，调用者=能调工具的模型；没有新增远程执行面、没有匿名执行端点、没有提权、没有遥测。
- **写入/暂停策略**：保留上游 lease（写通道占用 409）、写 scope grant/revoke、`human_action_required`（pause 只能人来点）、txn 快照/回滚。
- **停止/卸载**：父进程通过子进程 stdin 发 `{"op":"shutdown"}`（不依赖 Windows 上不可靠的 SIGTERM 处理器）；子侧先关 HTTP（不再接新任务），再按作业自己的 owner 身份 cancel **它自己拥有的** headless/queue 作业（只杀这些作业拉起的进程树），bounded 等待 PID 消失后退出；父侧只在超时后 kill。
- **不改用户环境**：不写全局配置、不装 addon、不停止/禁用既有进程与 addon；Gateway 子进程随插件卸载关闭。
- 包内不含凭证、不含私密路径（日志/工作目录都在插件数据目录，运行时生成）、不含上游测试目录。

## 6. 构建与验证（本机实测）

```powershell
# 1. 依赖（仅构建期）
npm ci

# 2. 运行时：vendored TS → ESM（180 个 .js + 170 个 python/资源）+ 生成只读 op 清单（98）
node scripts/build-runtime.mjs

# 3. addon：暂存上游源码 → 应用 patches/addon-pairing-token.mjs → Blender 官方扩展构建
node scripts/build-addon.mjs --blender "<Blender 安装目录>\blender.exe"  # 或设 DSH_BLENDER_EXE
#   产出 addon/*.zip、vendor/PATCHES.lock.json、patches/addon-pairing-token.diff

# 4. 哈希锁定 / 复算
node scripts/verify-vendor.mjs --write   # 一次
node scripts/verify-vendor.mjs           # 之后每次复算

# 5. 官方 devkit（从 PI-Desktop v0.23.0 源码构建的 pi-plugin CLI）
node <devkit>/dist/cli.js check .
node <devkit>/dist/cli.js pack . --out dist

# 6. 验证
node tests/run-tests.mjs        # 33 项：Gateway/协议/工具/配对拒绝 + 真实 Blender 5.3 headless 作业
node tests/regressions.mjs      # 40 项：review #2-#8 定点回归（启动超时清理、停止取消作业、端口、会话契约/dry_run、日志流、abort、缓存、提示、端口）
node tests/gui-integration.mjs  # 11 项：隔离 Blender GUI + 真实 addon（带配对码）：doctor/inspect/py/see
python3 <i18n-gate.py>          # 官方 i18n 预检（https://plugins.aiuo.net/skill.md 内嵌脚本）
```

结果（2026-11-27 本机）：

- `tests/run-tests.mjs`：**33 / 33**（含 3 项 `/addon` 缺凭据/错凭据/带 Origin 的拒绝用例）；真实 `blender -b` 作业 submit→wait→collect，产物 PNG 5,671 B，日志里有 `BRIDGE_TEST_OK`。
- `tests/regressions.mjs`：**40 / 40**（启动超时/端口冲突清理（含日志流已关闭）、180s 作业被 stop 取消且 PID 消失、队列置 `canceled`、端口释放、会话契约（`action=help` 无会话成功 / 只读 op `addon_unreachable` / 写算子含 `dry_run` 精确 `session_required`）、stop→restart 日志追加、abort 语义、frames 上限、提示命令、端口归一）。
- `tests/gui-integration.mjs`：**11 / 11**（真实 addon 用配对码连上：doctor ok、inspect 25 命令、py stdout、viewport/camera PNG）。
- addon zip：`bcc0a7962cce85927687a638b088ba4507ecae74874c5a7a26731debfb07168a`，116,367 B（与 3.1.1/3.1.2 同一份已审字节，本次未重建）。
- `verify-vendor`：source 440 文件 / runtime 711 文件全哈希一致（上游基线未被 delta 覆盖）。
- devkit `check`：0 error，1 warning（`permission.high-risk`：`agent.tool.register`、`agent.prompt.inject` 需安装时显式授权，属预期）。
- 官方 i18n 预检：**0 fail / 6 review**（review 仅 `contributes.commands[].title` 为纯字符串——宿主 manifest schema 要求 string；面板已是 en/zh-CN 同键 copy table）。

## 7. 目录

```
manifest.json             PI 插件清单（三项权限、6 条命令、6 个 agentTools、skill、i18n 含 safetyNotes）
main.js                   onLoad/onUnload/onPanelInvoke + 工具注册 + 命令
bridge/                   宿主适配（gateway-entry / proc / client / tools / port / generated）
panel/index.html          诊断面板
skills/blender-modeling/  上游 MIT 建模 skill（随包注册）
addon/                    从源码 + 配对 delta 构建的 addon zip + SHA256SUMS
patches/                  addon 源 delta（可重建模块 + 生成的 unified diff）
vendor/source/            上游固定提交的 runtime / extension / skill 源码（完整对应源）
vendor/dsh-runtime/       runtime 的 tsc 构建产物 + Python 实现
vendor/UPSTREAM.lock.json 上游每文件 sha256
vendor/PATCHES.lock.json  delta 的 before/after sha256
scripts/                  构建、打包 addon、哈希锁定
tests/                    协议/工具/实机验证
LICENSE / NOTICE          许可与边界（BSD / GPL / MIT；NOTICE 含 GPL §5a 变更声明）
VERIFICATION.md           验收记录（逐条修复/断言/哈希/限制）
```

## 8. 许可

- 适配层与 vendored runtime：**BSD-3-Clause**（`LICENSE`，上游 `Copyright (c) 2026, sixtyseven67`）。
- `vendor/source/extension/**` 与 `addon/*.zip`：**GPL-3.0-or-later**（完整文本 `vendor/source/extension/LICENSE`；上游 `NOTICE` 保留 ahujasid/blender-mcp 的 MIT 声明与代码来源）。
- `skills/blender-modeling/**`：**MIT**（`skills/blender-modeling/LICENSE` + `NOTICE.md`）。

详见 `NOTICE`。Blender 是 Blender Foundation 的商标；本项目为第三方适配，不代表 Blender Foundation 或 vastsa。
