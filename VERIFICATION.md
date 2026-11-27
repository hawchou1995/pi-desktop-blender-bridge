# 验收记录（VERIFICATION）— 3.1.4（含 3.1.2 / 3.1.3 历史）

## 3.1.4 增量（打包门禁 + diff 脱敏，不重建 addon）

- 日期：2026-11-27（本机）。范围只有三类：`scripts/build-addon.mjs` 的 diff 生成、`manifest.json` 的根级 `repository`、版本载体 3.1.3 → 3.1.4。**业务代码（`bridge/`、`panel/`、`main.js` 逻辑）、addon 源与 addon ZIP 均未改。**
- 脚本缺陷：改动前的 `scripts/build-addon.mjs` 重复声明 `HEADER_PATH`（原 103 与 106 行），任何调用都会 SyntaxError；本轮删掉重复项，保留严格正则 `^[ab]\/(?!\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$` 与 `--diff-only`。
- 重生成（不手写 diff，不 `apply_patch`/`git apply`）：`node scripts/build-addon.mjs --diff-only` → **exit 0**。`patches/addon-pairing-token.diff` 头部为 `a/vendor/source/extension/dsh_blender_bridge/…` ↔ `b/build/addon-src/dsh_blender_bridge/…`（cwd=仓库根 + 相对入参的 `git diff --no-index`），全文扫描无盘符、用户名、scratch GUID。
- addon ZIP 未覆盖：`addon/dsh_blender_bridge-2.0.0.zip` 116,367 B · sha256 `bcc0a7962cce85927687a638b088ba4507ecae74874c5a7a26731debfb07168a`（与 3.1.1/3.1.2/3.1.3 同一份已审字节）；`patches/addon-pairing-token.mjs` 的 `PATCH_VERSION` 仍为 `3.1.2`，历史声明准确。
- 门禁：devkit `check` → 0 error / 1 warn（`permission.high-risk`，预期），1190 files / 8.79 MB；`pack` → `dist/io.github.hawchou1995.pi-desktop-blender-bridge-3.1.4.piplug`，字节与 sha256 见 `dist/SHA256SUMS`（包内不自述自身哈希，避免自指）。
- 保留：`dist/…-3.1.1/3.1.2/3.1.3.piplug` 全部原样保留，未覆盖（3.1.3 正被另一 agent 用于本机测试）。
- 3.1.1/3.1.2/3.1.3 归档与本版的 member 级差分、私密路径扫描结论见构建检查点（scratch）与 3.1.4 回执。

- 日期：2026-11-27（本机）；3.1.3 只收尾两个 reviewer 项（#5 会话契约统一、#2 日志流生命周期），**不重做架构、不改安全模型、不重建 addon、不发布**。
- 上游：`sixtysevenlf/dsh-blender-plugin` @ `6c5614712972a5cbca52b13d4df9193d76e76b0d`（3.1.0-alpha.1 / addon 2.0.0 / protocol 12）
- 宿主：PI-Desktop 0.23.0；Blender 5.3.0；Node v26.13.1
- 结论：3.1.3 全绿——`run-tests` 33/33、`regressions` 40/40、真实 GUI `gui-integration` 11/11、devkit `check` 0 error / 1 expected warn、官方 i18n 0 fail / 6 review。
- 历史：以下第 1–6 节是 **3.1.2** 的 #1–#8 验收记录，原文保留（未改写）。

## 0. 3.1.3 修复（路径:行 / 断言）

| # | 缺陷 | 修复 | 路径:行 | 验证断言 |
|---|---|---|---|---|
| 5 | `tools.cjs` 承诺 `dry_run` 免会话，但 Gateway/算子在 Blender 内执行，非只读 op 实际仍需 ready 会话 | `/plan` 分支**删掉 `dry_run` 绕过**：非只读 op 一律先 `requireReady()`，提前返回精确 `session_required` + attach/start 选项（与只读路径同样的提示）；工具 description、`opHelp()`、`manifest.json`、README 统一成同一契约；loop/opt/preset 按上游 `src/tools/op/execute.ts`（`opt`/`preset` gate(true)，`loop` 仅 `target==='session'` 放行）如实标记；`failFromBody()` code 稳定化（`declared` → 裸 token → `stage==='transport' ? addon_unreachable : backend_error`），中文消息不再当 code | `bridge/tools.cjs:425-431`（opHelp 会话契约行）、`437-442`（tool description）、`448`（args 说明）、`450`（target 说明）、`484-490`（plan 会话门）、`1053-1070`（failFromBody）、`manifest.json:229`（description）、`manifest.json:247-250`（args）、`README.md:61`（工具表）、`README.md:69`（会话契约段） | `tests/regressions.mjs:126-169`：`op.help-needs-no-session`（`ok===true`，真实无会话成功）、`op.readonly-no-session-gate`（精确 `code==='addon_unreachable'`）、`op.write-needs-session`（`session_required`）、`op.write-dry-run-needs-session`（**精确 `session_required`**，替换旧的 `code !== 'session_required'` 弱断言）、`op.write-dry-run-same-hint`（dry_run 与普通写的 `choices`/`fix` 逐字相同）、`op.loop-gui-needs-session`、`op.opt-needs-session`、`op.preset-needs-session`（均精确 `session_required`）、`op.loop-session-target-no-gui-gate`（精确 `addon_unreachable`：GUI 门未泄漏到该分支） |
| 2 | `bridge/proc.cjs:299` 的日志 `WriteStream` 未 `end()`：stop/失败/重启可能写已结束流或泄漏 fd | 日志流按**子进程生命周期**管理：`_openLog()`（先关旧流，`error` 时把 `logStream` 置空）、`_closeLog()`（幂等 `end()` + 置空）、`_logTo()`（仅当 `this.logStream === stream` 且 `!writableEnded && writable` 时写，异常吞掉）；`_disposeChild()` 与 child `close` 事件都关闭；重启复用同一 `gateway.log` 以 `flags:'a'` 追加 | `bridge/proc.cjs:132`（`this.logStream = null`）、`277-281`（`_disposeChild` 内关闭）、`284-292`（`_openLog`）、`295-304`（`_closeLog`）、`307-315`（`_logTo`）、`338-348`（open + 启动头）、`372-376`（stderr + `close` 关闭）、`391-393`（stdout 走 `_logTo`） | `tests/regressions.mjs`：`log.stream-open-after-start`、`log.stream-closed-after-stop`（`logStream===null` 且 `writableEnded===true`）、`log.restart-new-stream`、`log.restart-appends`（实测 size 1394→1999 B、启动头 2→3，证明追加而非截断）、`log.stream-closed-after-restart-stop`、`log.stream-closed-after-failed-start`（端口冲突路径）、`log.stream-closed-after-timeout`（ready 超时路径） |

## 0.1 3.1.3 构建产物（3.1.1 / 3.1.2 保留不覆盖）

| 项 | 3.1.3 | 3.1.2（留档） | 3.1.1（留档） |
|---|---|---|---|
| `.piplug` | `dist/io.github.hawchou1995.pi-desktop-blender-bridge-3.1.3.piplug` | `dist/…-3.1.2.piplug` | `dist/…-3.1.1.piplug` |
| 字节 / SHA256 | 见 `dist/SHA256SUMS`（包内不自述自身哈希，避免自指；实测值同时记在构建检查点） | 9,417,683 · `d8cdc994…` | 9,339,855 · `a69daac9…` |
| 条目 | 1190（全部 store-only） | 1190 | 1185 |

- addon zip **未重建**：`addon/dsh_blender_bridge-2.0.0.zip` 116,367 B · sha256 `bcc0a7962cce85927687a638b088ba4507ecae74874c5a7a26731debfb07168a`（与 3.1.1/3.1.2 同一份已审字节；无版本/许可声明变更）。
- 上游基线未改写：`vendor/UPSTREAM.lock.json` 不动（source=440 / runtime=711，`verify-vendor` OK）；`vendor/PATCHES.lock.json` 不动。
- `manifest.json` / `package.json` / `main.js` 版本统一为 `3.1.3`；`patches/addon-pairing-token.mjs` 的 `PATCH_VERSION='3.1.2'` 保留（addon 未重建，历史声明仍准确）。

## 1. reviewer 缺陷 → 修复（3.1.2 记录，路径 / 行号 / 断言）

| # | 缺陷 | 修复 | 路径:行 | 验证断言 |
|---|---|---|---|---|
| 1 | `/addon` 无凭据可冒充 | addon 升级必须带 `x-dsh-bridge-token`；PI 生成并持久化一次性配对码，面板/命令显示，addon prefs 或 `DSHBB_GATEWAY_TOKEN` 保存；缺失/错误在 upgrade 前 403（同一不透明响应）；addon 端以可重建 delta 打补丁并加 GPL 变更声明 | `bridge/gateway-entry.mjs:29,90-105,111`、`bridge/proc.cjs:171-190`（`--addon-token`）、`main.js:58-90`（`loadOrCreatePairing`）、`main.js:241-266`（复制/轮换命令）、`panel/index.html:75-90,263-282`、`patches/addon-pairing-token.mjs:35,89,117,149` | `security.addon-upgrade-refused-without-secret`、`…-with-wrong-secret`、`…-with-origin` 均 403；`tests/gui-integration.mjs` 用真实 addon + 正确配对码 `session.ready` 通过（11/11） |
| 2 | 启动超时/失败留下 child、二次 start 覆盖句柄 | start/stop/restart 串行化（`_serialize`）；失败/超时统一 `_disposeChild`（IPC→等退出→kill→SIGKILL，bounded）并清句柄 | `bridge/proc.cjs:210-227,245-276,278-396` | `start.port-conflict-rejects/-no-leftover-handle/-no-new-process/-holder-alive`；`start.timeout-rejects/-cleaned/-no-new-process/-port-released`（stub entry 永不 ready） |
| 3 | 停止不取消 headless/queue；Windows SIGTERM 不可靠 | 父→子 **stdin IPC**（`{"op":"shutdown"}`）；子侧先关 HTTP（停收新任务）→按 job 自己的 owner 身份 cancel 自己拥有的作业→等待 PID 消失（bounded）→关闭退出；父侧只在超时后 kill；只动自己拉起的进程 | `bridge/gateway-entry.mjs:208-291`、`bridge/proc.cjs:245-276,398-410` | `stop.long-job-*`：提交 180s headless 作业→`stop()` 606ms 返回、Blender PID 已消失、`report.canceled` 列出该 job、端口释放、`queue.json` 状态 `canceled` |
| 4 | 端口校验跨层不一致 | 单一 `normalizePort()`；supervisor/client/tools/main 共用 | `bridge/port.cjs:1-19`、`bridge/proc.cjs:133-135`、`bridge/tools.cjs:203`、`main.js:45-50` | `port.invalid-falls-back`、`port.valid-kept`、`port.supervisor-uses-normalizer`、`port.tools-share-normalizer` |
| 5 | dry_run / loop/opt/preset 只读维度与上游不一致 | `/opt` 改为 `opt_join`/`opt_analyze` + `args`；`/preset` 按上游只传 name/kind/note/path/tags/names/targets/data/overwrite；`/loop` 按上游 GUI payload 与默认值；补齐 op schema 缺失 15 个参数；只读集合仍由 `runtime/catalog/data.ts` 生成（98，与上游 host 列表逐一相同） | `bridge/tools.cjs:481-503,517-557`、`manifest.json`（blender_op schema） | `op.readonly-no-session-gate`、`op.write-needs-session`、`op.dry-run-skips-session-gate`、`op.opt-needs-session`、`op.preset-needs-session`、`op.loop-session-target-skips-gui-gate` |
| 6 | `ctx.signal` 未传给 fetch | client 合并外部 AbortSignal 与超时；中止只结束本地等待并返回 `aborted`（明示不抢占 bpy） | `bridge/client.cjs:42-45,54,66-100`、`bridge/tools.cjs:206-216` | `abort.local-wait-only`（code=aborted）、`abort.does-not-kill-gateway`（/health 仍 200） |
| 7 | frames 目录无上限 | 只清理本适配写出的 `see-*/py-see-*.png`，按数量/字节淘汰最旧，用户文件不动 | `bridge/tools.cjs:27,164-201` | `frames.budget-only-own-files`（删 2 留 1，`user-photo.png`/`notes.txt` 原样） |
| 8 | 提示指向不存在的命令 | hint 改为真实命令标题；`ensureStarted` 的 autoStart 提示指向“重启 Gateway” | `bridge/tools.cjs:1028`、`main.js:96` | `hints.point-at-real-commands`（全部命中 manifest 标题）、`hints.no-ghost-start-command` |

## 2. 构建产物（3.1.2；3.1.1 保留不覆盖）

| 项 | 3.1.2 | 3.1.1（留档） |
|---|---|---|
| `.piplug` | `dist/io.github.hawchou1995.pi-desktop-blender-bridge-3.1.2.piplug` | `dist/…-3.1.1.piplug` |
| 字节 / SHA256 | 见 `dist/SHA256SUMS`（包内不自述自身哈希，避免自指；本版打包后的实测值记录在构建检查点里） | 9,339,855 · `a69daac9…`（留档，不覆盖） |
| 条目 | 1190（全部 store-only） | 1185 |

- addon zip：`addon/dsh_blender_bridge-2.0.0.zip` 116,367 B · sha256 `bcc0a7962cce85927687a638b088ba4507ecae74874c5a7a26731debfb07168a`（含配对 delta；两次构建字节一致）
- delta 锁：`vendor/PATCHES.lock.json`（4 个修改文件的 before/after sha256 + 逐条 edit 说明）；可读 diff：`patches/addon-pairing-token.diff`；上游基线 `vendor/UPSTREAM.lock.json` 未改写（source=440 / runtime=711，`verify-vendor` OK）
- 私密路径扫描：1190 条目无本机用户名 / scratch GUID；无 `.git|node_modules|dist|build` 条目；包内无配对码（运行时生成）

## 3. 测试

| 套件 | 结果 | 说明 |
|---|---|---|
| `tests/run-tests.mjs` | **33 / 33** | 原 30 项 + 3 项 `/addon` 拒绝（缺凭据/错凭据/带 Origin，仅拒绝用例，不伪造实例） |
| `tests/regressions.mjs` | **30 / 30** | #2–#8 定点回归（见上表） |
| `tests/gui-integration.mjs` | **11 / 11** | 真实 Blender 5.3 + 真实 addon（带配对码连接）：doctor ok、inspect 25 命令、py stdout、viewport/camera PNG 往返 |

证据：`$SCRATCH/bridge-test/results.json`、`$SCRATCH/regressions/results.json`、`$SCRATCH/gui-test/gui-results.json`、`$SCRATCH/logs/*.log`。

## 4. 官方门禁

- devkit（PI-Desktop v0.23.0 源码构建）：`check` → 0 error / 1 warn（high-risk 权限，预期）；`pack` → 上表。
- i18n 预检（https://plugins.aiuo.net/skill.md 内嵌脚本，原样执行）：**0 fail / 6 review**。review 全部是 `contributes.commands[].title` 为纯字符串——宿主 manifest schema 明确要求 string（改成 `{en, zh-CN}` 会被 devkit 判 `manifest.invalid: command … requires a title`），故保留 string 并在 i18n 块补齐 `safetyNotes`；面板已是 en/zh-CN 同键 copy table（0 review）。

## 5. 未验证 / 限制

1. 未在真实 PI 宿主中加载插件（不装入日常配置）：`onLoad`/面板/权限授予仍按源码与示例核对。
2. `ELECTRON_RUN_AS_NODE` 分支未在 PI 进程内实测（测试用系统 node）。
3. `virtual-gui` 不可用（上游未随包发布 Windows hidden-desktop helper）。
4. `loop/opt/preset` 的真实执行需要 GUI 会话；本次只验证了门控与 payload/参数契约（无 addon 时会话门生效）。
5. `/addon` 配对仍依赖 addon 侧 prefs/env 保存同一个码；轮换后需重新配对（命令/面板已提供）。
6. 只验证 Windows；Linux/macOS 未测。发布动作（plugin center）未执行。

## 6. review 用关键文件（≤10）

| # | 文件 | 关注点 |
|---|---|---|
| 1 | `bridge/gateway-entry.mjs` | 配对门（90-105）、bounded shutdown + 作业取消（208-291） |
| 2 | `bridge/proc.cjs` | 串行化（210）、失败清理（245）、IPC stdin + 停止（245-276,398） |
| 3 | `bridge/tools.cjs` | #5 payload/门控、#6 signal、#7 缓存、#8 hint、#4 端口 |
| 4 | `bridge/client.cjs` | AbortSignal 语义（42-100） |
| 5 | `bridge/port.cjs` | 单一端口契约 |
| 6 | `main.js` | 配对生成/持久化/命令/面板通道（58-90,241-266,309-352） |
| 7 | `patches/addon-pairing-token.mjs` | 唯一 addon 源 delta（4 文件 8 处 edit） |
| 8 | `tests/regressions.mjs` | #2–#8 断言 |
| 9 | `panel/index.html` | en/zh-CN copy table + 配对 UI |
| 10 | `NOTICE` | GPL §5a 变更声明与许可边界 |
