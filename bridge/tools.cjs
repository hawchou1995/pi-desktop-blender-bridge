'use strict'
/**
 * The six model tools, ported to PI-Desktop's agent-tool API.
 *
 * The *contract* (names, actions, parameters, gateway routes) is upstream's:
 *   src/tools/{session,op,py,see,run,inspect}/index.ts  (schemas)
 *   src/tools/**\/execute.ts                            (route + payload mapping)
 *   src/tools/op/read-only.ts                           (session gate)
 *
 * What is not ported: the DSH-specific presentation layer (card presenters,
 * `renderOne`, TUI chips/@-mentions) and the DSH tool-error envelope. This file
 * returns the Gateway's real payload plus a short human summary, and reports
 * failures as `{ ok:false, code, text, fix }` instead of a DSH envelope.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { GatewayClient, TOKEN_HEADER } = require('./client.cjs')
const { DEFAULT_GATEWAY_PORT, normalizePort } = require('./port.cjs')

const DEFAULT_PORT = DEFAULT_GATEWAY_PORT
/**
 * Cache budget for `<plugin data>/frames`. Only files this adapter writes
 * (prefix list below) are ever removed, oldest first; user files are untouched.
 */
const FRAME_CACHE = { maxFiles: 200, maxBytes: 256 * 1024 * 1024, prefixes: ['see-', 'py-see-'] }
const DEFAULT_SEE_SIZE = { '1:1': 1024, '4:3': 1280, '16:9': 1024 }
const SIZES = {
  '1:1': [544, 768, 1024, 1280],
  '4:3': [640, 960, 1280],
  '16:9': [1024, 1152, 1280],
  camera: [544, 768, 1024, 1280],
}

const READ_ONLY_OPS = (() => {
  try {
    const file = path.join(__dirname, 'generated', 'read-only-ops.json')
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return new Set(Array.isArray(parsed.ops) ? parsed.ops.map(String) : [])
  } catch {
    return new Set()
  }
})()

function text(value) {
  return value === undefined || value === null ? '' : String(value)
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function jsonPayload(raw) {
  if (raw === undefined || raw === null || raw === '') return {}
  if (isRecord(raw)) return { ...raw }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function argsInvalid(raw) {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '{}') return false
  try {
    const parsed = JSON.parse(trimmed)
    return !isRecord(parsed)
  } catch {
    return true
  }
}

/** Upstream preset/loop list fields arrive as comma-separated strings. */
function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseScopes(raw) {
  if (raw === undefined || raw === null) return undefined
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  const value = String(raw).trim()
  if (!value) return undefined
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
    } catch {
      /* fall through to comma split */
    }
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function fail(code, message, fix, extra) {
  return { ok: false, code, text: message, fix, ...(extra || {}) }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function pngSize(buffer) {
  if (!buffer || buffer.length < 24) return [0, 0]
  if (buffer.readUInt32BE(0) !== 0x89504e47) return [0, 0]
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

const SESSION_NEEDED = [
  'detach',
  'release',
  'stop',
  'pause',
  'resume',
  'mark_read',
  'presence',
  'heartbeat',
  'grants',
  'grant',
  'revoke',
]

const WRONG_TOOL = {
  export_scene: ['blender_op', '导出用 blender_op 的 deliver_* / 导出算子'],
  set_texture: ['blender_op', '材质/贴图用 blender_op 的 material_* 算子'],
  download_polyhaven_asset: ['blender_py', '外部资产下载改用 blender_py 脚本'],
  get_polyhaven_asset_preview: ['blender_py', '预览图改用 blender_see'],
  create_rodin_job: ['blender_py', 'Hyper3D 生成改用 blender_py；只读轮询留 inspect'],
  import_generated_asset: ['blender_py', '生成结果导入用 blender_py'],
  download_sketchfab_model: ['blender_py', 'Sketchfab 下载改用 blender_py；搜索仍可 inspect'],
  download_polypizza_model: ['blender_py', 'Poly Pizza 下载改用 blender_py；搜索仍可 inspect'],
  create_hunyuan_job: ['blender_py', 'Hunyuan3D 生成改用 blender_py；只读轮询留 inspect'],
  import_generated_asset_hunyuan: ['blender_py', '生成结果导入用 blender_py'],
  get_telemetry_consent: ['none', '3.1 零遥测：没有该命令'],
  set_telemetry_consent: ['none', '3.1 零遥测：没有该命令'],
  drain_human_activity: ['blender_session', '人改事件由 Gateway 事件流送达；查询用 get_activity_state'],
  execute_code: ['blender_py', '执行 Python 用 blender_py'],
  get_viewport_screenshot: ['blender_see', '截图用 blender_see'],
  send_selection_to_dsh: ['none', 'N 面板内部传输；选中用 get_selection'],
  send_collection_to_dsh: ['none', 'N 面板内部传输；集合用 get_collections'],
}

/**
 * Enforce the frame-cache budget. Deletes only adapter-owned files (names that
 * start with one of the prefix list entries), oldest first, and never anything
 * the user placed in that directory.
 */
function pruneFrames(dir, budget) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { removed: 0, kept: 0, bytes: 0, reason: 'unreadable' }
  }
  const owned = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    if (!budget.prefixes.some((prefix) => entry.name.startsWith(prefix))) continue
    try {
      const stat = fs.statSync(path.join(dir, entry.name))
      owned.push({ name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs })
    } catch {
      /* raced with another writer */
    }
  }
  owned.sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = owned.reduce((sum, file) => sum + file.size, 0)
  let removed = 0
  while (owned.length && (owned.length > budget.maxFiles || total > budget.maxBytes)) {
    const victim = owned.shift()
    try {
      fs.rmSync(path.join(dir, victim.name), { force: true })
      total -= victim.size
      removed += 1
    } catch {
      break
    }
  }
  return { removed, kept: owned.length, bytes: total }
}

function makeTools(deps) {
  const settings = deps.settings || {}
  const dataDir = deps.dataDir
  // One port contract with the supervisor (bridge/port.cjs): an invalid
  // setting falls back to the same value the Gateway will listen on.
  const port = normalizePort(settings.gatewayPort)
  const framesDir = path.join(dataDir, 'frames')

  function client(ctx) {
    return new GatewayClient({
      port,
      token: deps.getToken(),
      holder: 'pi-desktop',
      caller: ctx,
      // Aborts the local wait only; it cannot preempt bpy inside Blender.
      signal: ctx && ctx.signal ? ctx.signal : null,
    })
  }

  function saveFrame(buffer, name) {
    fs.mkdirSync(framesDir, { recursive: true })
    const file = path.join(framesDir, name)
    fs.writeFileSync(file, buffer)
    pruneFrames(framesDir, FRAME_CACHE)
    const [width, height] = pngSize(buffer)
    return { file, bytes: buffer.length, width, height, sha256: sha256(buffer) }
  }

  async function listSessions(c) {
    const body = await c.post('/lease', { action: 'list' }, 20000)
    if (body.ok !== true) return { ok: false, body }
    return { ok: true, sessions: Array.isArray(body.sessions) ? body.sessions.filter(isRecord) : [] }
  }

  function readyRow(sessions) {
    const ready = sessions.filter(
      (row) => String(row.status || '') === 'ready' && String(row.instanceId || '') !== '',
    )
    return (
      ready.find((row) => String(row.kind || '') === 'user-gui') ||
      ready.find((row) => String(row.kind || '') === 'virtual-gui') ||
      ready[0] ||
      null
    )
  }

  const sessionRequired = () =>
    fail(
      'session_required',
      '没有 ready 的 GUI 会话：不会自动启动 Blender，也不会静默转 headless',
      '让用户在 Blender 的 N 面板点 Connect，然后 blender_session action=attach；或经用户同意 blender_session action=start kind=virtual-gui',
      {
        choices: [
          { action: 'attach', tool: 'blender_session' },
          { action: 'start', tool: 'blender_session', kind: 'virtual-gui' },
        ],
      },
    )

  async function requireReady(c) {
    const listed = await listSessions(c)
    if (!listed.ok) {
      return {
        ok: false,
        failure: fail(
          'gateway_unreachable',
          'Gateway /lease 失败：' + text(listed.body.error || listed.body.raw || 'unknown'),
          '在命令面板运行「Blender Bridge: 状态」，或打开本插件诊断面板看 Gateway 状态',
        ),
      }
    }
    const row = readyRow(listed.sessions)
    if (!row) return { ok: false, failure: sessionRequired() }
    return { ok: true, row }
  }

  // ---------------------------------------------------------------- session
  const sessionTool = {
    name: 'blender_session',
    risk: 'medium',
    description:
      '[v3.1] 会话/归属/权限：list/status/doctor 看状态；attach 附着到用户已打开的 Blender（多实例给 instance_id）；' +
      'grant/revoke 把写 scope（exclusive | collection:名 | prefix:名 | object:名）授予子 agent；' +
      'pause/resume 只有人类能操作（agent 调用返回 human_action_required）；mark_read 清 human_modified 冲突；' +
      'start/stop 只作用 virtual-gui（start 首次返回 consent_required）；txn 子面 snapshot/restore/list/prune/mark/revert/marks/drop。' +
      'Gateway 进程由 PI-Desktop 插件托管，不是模型面动作。',
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list',
            'status',
            'doctor',
            'attach',
            'claim',
            'detach',
            'release',
            'grant',
            'revoke',
            'grants',
            'pause',
            'resume',
            'mark_read',
            'presence',
            'heartbeat',
            'start',
            'stop',
            'txn',
            'help',
          ],
          description: '见工具描述；默认 list',
        },
        session_id: { type: 'string', description: '会话 id（大多数会话级动作必填）' },
        instance_id: { type: 'string', description: 'attach/claim 的 addon 实例 id' },
        kind: { type: 'string', description: 'start 的会话类型，只接受 virtual-gui' },
        scopes: {
          type: 'string',
          description: 'grant/mark_read 的 scope：exclusive、collection:COL、prefix:OBJ_、object:Cube（逗号分隔）',
        },
        target_agent_id: { type: 'string', description: 'grant 的目标 agent id' },
        target_dsh_session_id: { type: 'string', description: 'grant 的目标会话 id' },
        target_host_id: { type: 'string', description: 'grant 的目标 host id' },
        grant_id: { type: 'string', description: 'revoke 的 grant id' },
        ttl_ms: { type: 'integer', description: 'grant 有效期毫秒' },
        op: {
          type: 'string',
          enum: ['snapshot', 'restore', 'list', 'prune', 'mark', 'revert', 'marks', 'drop', 'help'],
          description: 'txn 子动作（默认 list）',
        },
        label: { type: 'string', description: 'txn 快照/mark 的名字' },
        note: { type: 'string', description: 'txn snapshot 备注' },
        objects: { type: 'string', description: 'txn mark 限定对象（逗号分隔）' },
        keep: { type: 'integer', description: 'txn prune 保留最近 N 个快照' },
        into: { type: 'string', enum: ['auto', 'snapshot', 'original'], description: 'txn restore 目标' },
        backup: { type: 'boolean', description: 'txn restore 是否先留 pre_restore 备份' },
        force: { type: 'boolean', description: '保留参数' },
      },
      required: ['action'],
    },
    async execute(rawArgs, ctx) {
      const args = jsonPayload(rawArgs)
      const c = client(ctx)
      const action = text(args.action).trim() || 'list'
      const CAMEL = {
        session_id: 'sessionId',
        instance_id: 'instanceId',
        kind: 'kind',
        grant_id: 'grantId',
        ttl_ms: 'ttlMs',
        target_agent_id: 'targetAgentId',
        target_dsh_session_id: 'targetDshSessionId',
        target_host_id: 'targetHostId',
        force: 'force',
      }
      const payload = {}
      for (const [snake, camel] of Object.entries(CAMEL)) if (present(args[snake])) payload[camel] = args[snake]
      const scopes = parseScopes(args.scopes !== undefined ? args.scopes : args.scope)
      if (scopes !== undefined) payload.scopes = scopes
      if (action === 'start') payload.kind = present(args.kind) ? text(args.kind) : 'virtual-gui'

      if (action === 'help') {
        return { ok: true, text: 'blender_session: list/status/doctor/attach/claim/grant/revoke/grants/pause/resume/mark_read/presence/heartbeat/txn' }
      }
      if (action === 'txn') {
        const body = await c.post(
          '/txn',
          { op: text(args.op).trim() || 'list', args: { ...args, op: undefined } },
          300000,
        )
        return body.ok === true ? { ok: true, text: 'TXN ' + text(args.op || 'list'), result: body.result || body } : failFromBody(body, 'TXN')
      }
      if (action === 'status') {
        const listed = await listSessions(c)
        if (!listed.ok) return failFromBody(listed.body, 'SESSION status')
        const body = await c.get('/status', 20000)
        return { ok: true, text: 'status · ' + text(body.state || body.status || (body.ok === false ? 'error' : 'ok')) + ' · sessions=' + String(listed.sessions.length), status: body, sessions: listed.sessions }
      }
      if (action === 'doctor') {
        const body = await c.get('/doctor', 60000)
      // /doctor answers with addon.kind + readiness; it has no top-level `kind`.
      const addon = isRecord(body.addon) ? body.addon : {}
      const readiness = isRecord(body.readiness) ? body.readiness : {}
      const ready = readiness.ready === true
      const addonKind = text(addon.kind || (ready ? 'ready' : 'unknown'))
      return {
        ok: true,
        ready,
        code: ready ? undefined : addonKind,
        text:
          'doctor · addon=' + addonKind + ' · ready=' + String(ready) +
          (addon.summary ? ' · ' + text(addon.summary) : '') +
          (body.fix && !ready ? '\nfix: ' + text(body.fix) : ''),
        doctor: body,
      }
      }
      if (action === 'list') {
        const listed = await listSessions(c)
        if (!listed.ok) return failFromBody(listed.body, 'SESSION list')
        return {
          ok: true,
          text:
            'sessions=' + String(listed.sessions.length) +
            (listed.sessions.length
              ? '\n' + listed.sessions.map((row) => '- ' + text(row.id) + ' · ' + text(row.kind) + ' · ' + text(row.status) + ' · instance=' + text(row.instanceId)).join('\n')
              : '（没有连接的 Blender；在 N 面板点 Connect）'),
          sessions: listed.sessions,
        }
      }
      if (action === 'start' && text(payload.kind) !== 'virtual-gui')
        return fail('invalid_params', 'start 只启动 virtual-gui', 'user-gui 由用户打开 Blender 并 Connect，然后 action=attach')
      if (SESSION_NEEDED.includes(action) && !present(args.session_id))
        return fail('invalid_params', action + ' 需要 session_id', '先 action=list 取会话 id')
      if (action === 'grant' && scopes === undefined)
        return fail('invalid_params', 'grant 需要 scopes', '例如 scopes="exclusive"')
      if (action === 'revoke' && !present(args.grant_id))
        return fail('invalid_params', 'revoke 需要 grant_id', '先 action=grants')
      const body = await c.post('/lease', { action, ...payload }, 20000)
      if (body.ok !== true) return failFromBody(body, 'SESSION ' + action)
      return { ok: true, text: 'SESSION ' + action + ' ok', result: body }
    },
  }

  // --------------------------------------------------------------------- op
  function opHelp() {
    return [
      'blender_op:',
      '  action=plan op=<catalog op> args={...}  (34 family / 228 op 主入口；op=catalog 看目录)',
      '  action=loop op=start|status|stop|board|export|help|bench  (target=gui|session)',
      '  action=opt  op=analyze|join|help',
      '  action=preset op=list|get|apply|save|delete|export|import|help',
      '会话契约：只读 op（98 个）与 action=help 不需要会话；写算子（含 args.dry_run=true）、loop(target=gui)、opt、preset 都需要 ready 的 GUI 会话；loop target=session 走持久无头 worker。',
    ].join('\n')
  }

  const opTool = {
    name: 'blender_op',
    risk: 'high',
    description:
      '[v3.1] catalog 算子执行 + 参数搜索：action=plan op=<op> args={...}（op=catalog 列 34 family / 228 op）。' +
      '会话契约：只读 op（catalog / status / audit_* / *_help 等 98 个）与 action=help 不需要会话；' +
      '任何写算子都需要 ready 的 GUI 会话，args 里的 dry_run 只让该算子跳过落盘/写入，不改变“需要会话”这一前提；' +
      'action=loop/opt/preset 全部需要 ready 会话（loop target=session 走持久无头 worker）。' +
      '执行一律走 Gateway /plan /loop /opt /preset，算子实现是随包 Python，不在本适配层重写。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['plan', 'loop', 'opt', 'preset', 'help'], description: '默认 plan' },
        op: { type: 'string', description: 'plan 的算子名（op=catalog 列目录）；loop/opt/preset 的子动作' },
        args: { type: 'string', description: '算子参数 JSON 对象，例如 {"family":"audit"}；dry_run=true 只让算子跳过落盘，仍需会话' },
        path: { type: 'string', description: 'plan report / loop export 的输出路径' },
        target: { type: 'string', enum: ['gui', 'session'], description: 'loop 的执行目标，默认 gui（session=持久无头 worker，不需要 GUI 会话）' },
        limit: { type: 'integer', description: 'loop board 候选条数，默认 10' },
        note: { type: 'string', description: 'loop export / preset save 备注' },
        kind: { type: 'string', description: 'preset 分类（material/object/scene）' },
        tags: { type: 'string', description: 'preset 标签（逗号分隔）' },
        // Remaining upstream op parameters (src/tools/op/index.ts). `json` in DSH
        // has no PI equivalent, so spec/data are accepted as JSON strings/objects.
        attach_images: { type: 'boolean', description: 'plan：是否把结果里的图附图（默认按 op 决定）' },
        session: { type: 'string', description: 'loop target=session 时的无头 worker 名（默认 dsh-loop）' },
        spec: { type: 'string', description: 'loop start：{setup, step, measure, iterations, budget_ms, ...}' },
        history: { type: 'integer', description: 'loop status：指标尾迹长度，默认 8' },
        board: { type: 'integer', description: 'loop status：同时返回前 N 个候选，默认 0' },
        groups: { type: 'boolean', description: 'loop board：是否包含分组候选（默认 true）' },
        top: { type: 'integer', description: 'loop export：变体数量，默认 1' },
        include_variants: { type: 'boolean', description: 'loop export：是否导出候选表' },
        iterations: { type: 'integer', description: 'loop bench：迭代次数，默认 5000' },
        name: { type: 'string', description: 'preset：配方名（get/apply/delete/save）' },
        names: { type: 'string', description: 'preset export：要导出的配方名（逗号分隔；省略=全部）' },
        targets: { type: 'string', description: 'preset apply：MAT:名 / OBJ:名 / SCENE（逗号分隔）' },
        data: { type: 'string', description: 'preset save：点路径 JSON，如 {"inputs.Roughness":0.4}' },
        overwrite: { type: 'boolean', description: 'preset save/import：是否覆盖同名（默认 true）' },
      },
      required: ['action'],
    },
    async execute(rawArgs, ctx) {
      const args = jsonPayload(rawArgs)
      const c = client(ctx)
      const action = text(args.action).trim() || 'plan'
      if (action === 'help') return { ok: true, text: opHelp() }
      if (action === 'plan') {
        const op = text(args.op) || 'status'
        if (argsInvalid(args.args))
          return fail('invalid_params', 'OP ' + op + ' · args 不是合法 JSON 对象', 'args 传 JSON 对象，例如 {"family":"audit"}')
        const payload = jsonPayload(args.args)
        // Contract: a write op executes inside Blender, so it needs a ready GUI
        // session even when args.dry_run is true — dry_run only tells the op to
        // skip writes. Only the host-local read-only ops skip the session gate.
        if (!READ_ONLY_OPS.has(op)) {
          const ready = await requireReady(c)
          if (!ready.ok) return ready.failure
        }
        if (op === 'report' && args.path) payload.path = text(args.path)
        const body = await c.post('/plan', { op, args: payload }, 300000)
        if (body.error === 'leased') return fail('lease_conflict', leasedText(body), '等当前写操作结束或 release 后重试')
        if (body.ok !== true) return failFromBody(body, 'OP ' + op)
        return { ok: true, text: 'OP ' + op + ' ok', result: body.result !== undefined ? body.result : body }
      }
      if (action === 'loop') {
        const target = text(args.target).trim() || 'gui'
        if (target !== 'gui' && target !== 'session')
          return fail('invalid_params', 'loop target 只能是 gui|session', 'target=session 走持久无头 worker')
        if (target !== 'session') {
          const ready = await requireReady(c)
          if (!ready.ok) return ready.failure
        }
        // Payload and defaults mirror upstream src/tools/op/loop.ts (GUI branch).
        const op = text(args.op).trim() || 'status'
        const payload = {
          op,
          spec: jsonPayload(args.spec),
          history: Number(args.history) || 8,
          board: Number(args.board) || 0,
          limit: Number(args.limit) || 10,
          groups: !(args.groups === false),
          path: args.path,
          top: Number(args.top) || 1,
          include_variants: args.include_variants === true,
          note: text(args.note),
          iterations: Number(args.iterations) || 5000,
        }
        if (present(args.session)) payload.session = text(args.session)
        const body = await c.post('/loop', payload, 300000)
        if (body.error === 'leased') return fail('lease_conflict', leasedText(body), '等当前写操作结束或 release 后重试')
        if (body.ok !== true) return failFromBody(body, 'LOOP ' + op)
        return { ok: true, text: 'LOOP ' + op + ' ok', result: body.result !== undefined ? body.result : body }
      }
      if (action === 'opt') {
        const ready = await requireReady(c)
        if (!ready.ok) return ready.failure
        // Upstream maps only `join`; everything else is analyze.
        const op = text(args.op).trim() || 'analyze'
        const oargs = jsonPayload(args.args)
        const body = await c.post(
          '/opt',
          { op: op === 'join' ? 'opt_join' : 'opt_analyze', args: Object.keys(oargs).length ? oargs : undefined },
          600000,
        )
        if (body.error === 'leased') return fail('lease_conflict', leasedText(body), '等当前写操作结束或 release 后重试')
        if (body.ok !== true) return failFromBody(body, 'OPT ' + op)
        return { ok: true, text: 'OPT ' + op + ' ok', result: body.result !== undefined ? body.result : body }
      }
      if (action === 'preset') {
        const ready = await requireReady(c)
        if (!ready.ok) return ready.failure
        const op = text(args.op).trim() || 'list'
        const presetArgs = {}
        if (text(args.name)) presetArgs.name = text(args.name)
        if (text(args.kind)) presetArgs.kind = text(args.kind)
        if (text(args.note)) presetArgs.note = text(args.note)
        if (text(args.path)) presetArgs.path = text(args.path)
        if (text(args.tags)) presetArgs.tags = splitList(args.tags)
        if (text(args.names)) presetArgs.names = splitList(args.names)
        if (text(args.targets)) presetArgs.targets = splitList(args.targets)
        if (args.data !== undefined && args.data !== null && args.data !== '') {
          const data = jsonPayload(args.data)
          if (!Object.keys(data).length) {
            return fail('invalid_params', 'preset data 不是合法 JSON 对象', '例如 data={"inputs.Roughness":0.4}')
          }
          presetArgs.data = data
        }
        if (args.overwrite === false) presetArgs.overwrite = false
        const body = await c.post('/preset', { op, args: presetArgs }, 300000)
        if (body.error === 'leased') return fail('lease_conflict', leasedText(body), '等当前写操作结束或 release 后重试')
        if (body.ok !== true) return failFromBody(body, 'PRESET ' + op)
        return { ok: true, text: 'PRESET ' + op + ' ok', result: body.result !== undefined ? body.result : body }
      }
      return fail('invalid_params', '未知 blender_op action：' + action, '可用 action：plan | loop | opt | preset | help')
    },
  }

  // --------------------------------------------------------------------- py
  const pyTool = {
    name: 'blender_py',
    risk: 'high',
    description:
      '[v3.1] 在 ready 的 GUI 会话里执行 Python（持久内核 K，sys.modules 语义）。见 see=true 时抓一帧回传（PNG 落盘到插件数据目录并返回绝对路径）。' +
      '只走 GUI 会话，没有 headless 回退；后台/无头请用 blender_run(kind=headless)。这是本地代码执行面：只由本机 PI 会话经带 token 的 loopback 通道调用。',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 Python 源码（与 file 二选一）' },
        file: { type: 'string', description: '要执行的 .py 文件路径（与 code 二选一）' },
        see: { type: 'boolean', description: '跑完是否抓当前视口一帧（默认 true）' },
        max_size: { type: 'integer', description: 'see 的最长边像素，默认 560' },
        force: { type: 'boolean', description: '同画面默认不重复附图' },
        wait_ms: { type: 'integer', description: '等待上限毫秒（默认 0 = 由 Gateway 决定）' },
      },
      required: [],
    },
    async execute(rawArgs, ctx) {
      const args = jsonPayload(rawArgs)
      const c = client(ctx)
      const code = text(args.code)
      const file = args.file ? String(args.file) : null
      if (!code && !file) return fail('invalid_params', 'PY 需要 code 或 file 之一', '给 code（短 Python）或 file（磁盘上的 .py 路径）')
      const ready = await requireReady(c)
      if (!ready.ok) return ready.failure
      const body = await c.post(
        '/act',
        { code, file, py: true, sessionId: text(ready.row.id), waitMs: Number(args.wait_ms) || 0 },
        180000,
      )
      if (body.error === 'leased') return fail('lease_conflict', leasedText(body), '等当前写操作结束或 release 后重试')
      if (body.ok !== true) return failFromBody(body, 'PY')
      // /act answers with top-level stdout/stderr/executed/ms (runtime/http/routes/act.ts).
      const out = {
        ok: true,
        text: 'PY ok · ' + text(body.ms) + 'ms · session=' + text(ready.row.id),
        result: {
          stdout: text(body.stdout || ''),
          stderr: text(body.stderr || ''),
          executed: body.executed === true,
          ms: body.ms,
          mainThreadMs: body.mainThreadMs,
        },
      }
      if (out.result.stderr.trim()) out.text += '\nstderr: ' + out.result.stderr.slice(0, 1200)
      if (out.result.stdout.trim()) out.text += '\nstdout: ' + out.result.stdout.slice(0, 4000)
      if (args.see !== false) {
        try {
          const size = Math.max(120, Math.min(1600, Number(args.max_size) || 560))
          const png = await c.png('/frame.png?size=' + String(size), 60000)
          const saved = saveFrame(png, 'py-see-' + String(Date.now()) + '.png')
          out.image_path = saved.file
          out.image = { path: saved.file, bytes: saved.bytes, width: saved.width, height: saved.height, sha256: saved.sha256 }
          out.text += '\nSEE ' + String(size) + 'px · ' + String(saved.width) + 'x' + String(saved.height) + ' · ' + String(saved.bytes) + 'B · sha256 ' + saved.sha256.slice(0, 16)
        } catch (error) {
          out.text += '\n⚠ 图片未回传：' + text(error && error.message)
        }
      }
      return out
    },
  }

  // -------------------------------------------------------------------- see
  function pickSize(aspect, requested) {
    const table = SIZES[aspect] || SIZES['16:9']
    if (!requested) return DEFAULT_SEE_SIZE[aspect] || 1024
    const value = Number(requested)
    return table.includes(value) ? value : null
  }

  const seeTool = {
    name: 'blender_see',
    risk: 'low',
    description:
      '[v3.1] GUI 抓帧：viewpoint=viewport（当前视口）/ camera（当前帧相机）/ custom（from+look_at），mode=frame|sequence。' +
      '固定档位 aspect=1:1（544/768/1024/1280）、4:3（640/960/1280）、16:9（1024/1152/1280），默认 16:9+1024；非法档位直接报错。' +
      '不改场景/选择/用户视口。PNG 写入插件数据目录并返回绝对路径（PI 插件工具不回传二进制图片内容）。最终渲染请用 blender_run(kind=render)。',
    schema: {
      type: 'object',
      properties: {
        viewpoint: { type: 'string', enum: ['viewport', 'camera', 'custom'], description: '默认 viewport' },
        mode: { type: 'string', enum: ['frame', 'sequence'], description: '默认 frame' },
        camera: { type: 'string', description: 'viewpoint=camera 的可选相机名' },
        aspect: { type: 'string', enum: ['1:1', '4:3', '16:9'], description: '默认 16:9' },
        max_size: { type: 'integer', description: '固定档位像素' },
        from: { type: 'string', description: '【custom】相机位置 "x,y,z"' },
        look_at: { type: 'string', description: '【custom】看向点 "x,y,z"' },
        lens: { type: 'number', description: '【custom】焦距 mm，默认 50' },
        ortho: { type: 'boolean', description: '【custom】正交投影' },
        ortho_scale: { type: 'number', description: '【custom】正交尺度' },
        full: { type: 'boolean', description: 'frame+viewport 整窗口截图' },
        area: { type: 'integer', description: 'full=true 时区域序号，默认 0' },
        shading: { type: 'string', enum: ['WIREFRAME', 'SOLID', 'MATERIAL', 'RENDERED'], description: '【custom/sequence】临时着色' },
        overlays: { type: 'boolean', description: '【custom/sequence】临时覆盖物开关' },
        diagnostics: { type: 'boolean', description: '强制跑覆盖率/空帧诊断' },
        seconds: { type: 'number', description: '【sequence】采样时长 0.2–20，默认 2' },
        fps: { type: 'number', description: '【sequence】采样频率 0.5–8，默认 4' },
        force: { type: 'boolean', description: '同画面默认不重复附图' },
      },
      required: [],
    },
    async execute(rawArgs, ctx) {
      const args = jsonPayload(rawArgs)
      const c = client(ctx)
      const viewpoint = text(args.viewpoint).trim() || 'viewport'
      const mode = text(args.mode).trim() || 'frame'
      if (!['viewport', 'camera', 'custom'].includes(viewpoint))
        return fail('invalid_params', 'viewpoint 只能是 viewport|camera|custom', '默认 viewport')
      if (!['frame', 'sequence'].includes(mode)) return fail('invalid_params', 'mode 只能是 frame|sequence', '默认 frame')
      const ready = await requireReady(c)
      if (!ready.ok) return ready.failure
      const sessionId = text(ready.row.id)

      if (mode === 'sequence') {
        if (viewpoint === 'camera') return fail('invalid_params', 'sequence 只支持 viewport|custom', '相机序列请用 blender_run(kind=render)')
        const seconds = Math.min(20, Math.max(0.2, Number(args.seconds) || 2))
        const fps = Math.min(8, Math.max(0.5, Number(args.fps) || 4))
        const total = Math.max(1, Math.min(32, Math.round(seconds * fps)))
        const aspect = text(args.aspect) || '16:9'
        const size = pickSize(aspect, args.max_size)
        if (size === null) return fail('invalid_params', '非法 max_size 档位', '16:9 用 1024/1152/1280')
        const dims = aspect === '1:1' ? [size, size] : aspect === '4:3' ? [size, Math.round((size * 3) / 4)] : [size, Math.round((size * 9) / 16)]
        const spec =
          viewpoint === 'custom'
            ? { mode: 'viewport', from: args.from, look_at: args.look_at, lens: args.lens, ortho: args.ortho, ortho_scale: args.ortho_scale, width: dims[0], height: dims[1], shading: args.shading, overlays: args.overlays }
            : { mode: 'current', width: dims[0], height: dims[1] }
        const interval = (seconds * 1000) / total
        const frames = []
        for (let i = 0; i < total; i += 1) {
          if (ctx && ctx.signal && ctx.signal.aborted) return fail('aborted', 'sequence 被取消', '重试')
          const view = await c.view(spec, 180000)
          frames.push(saveFrame(view.png, 'see-seq-' + String(Date.now()) + '-' + String(i) + '.png'))
          if (i + 1 < total) await new Promise((resolve) => setTimeout(resolve, interval))
        }
        return {
          ok: true,
          text: 'SEE sequence ' + String(frames.length) + ' 帧 · ' + String(dims[0]) + 'x' + String(dims[1]) + '\n' + frames.map((f) => f.file).join('\n'),
          frames: frames.map((f) => ({ path: f.file, width: f.width, height: f.height, sha256: f.sha256 })),
        }
      }

      if (viewpoint === 'viewport' && args.full === true) {
        const area = Number(args.area) || 0
        const png = await c.png('/frame.png?full=1&area=' + String(area), 60000)
        const saved = saveFrame(png, 'see-full-' + String(Date.now()) + '.png')
        return { ok: true, text: 'SEE full · ' + String(saved.width) + 'x' + String(saved.height) + ' · ' + String(saved.bytes) + 'B · sha256 ' + saved.sha256.slice(0, 16), image_path: saved.file, image: saved }
      }
      if (viewpoint === 'camera') {
        const size = pickSize('camera', args.max_size)
        if (size === null) return fail('invalid_params', '非法 max_size 档位', 'camera 用 544/768/1024/1280')
        const view = await c.view({ mode: 'camera', camera: text(args.camera), max_size: size }, 180000)
        const saved = saveFrame(view.png, 'see-camera-' + String(Date.now()) + '.png')
        return {
          ok: true,
          text: 'SEE camera · ' + String(saved.width) + 'x' + String(saved.height) + ' · sha256 ' + saved.sha256.slice(0, 16),
          image_path: saved.file,
          image: saved,
          meta: view.meta,
        }
      }
      const aspect = text(args.aspect) || '16:9'
      const size = pickSize(aspect, args.max_size)
      if (size === null) return fail('invalid_params', '非法 max_size 档位', '16:9 用 1024/1152/1280；4:3 用 640/960/1280；1:1 用 544/768/1024/1280')
      const dims = aspect === '1:1' ? [size, size] : aspect === '4:3' ? [size, Math.round((size * 3) / 4)] : [size, Math.round((size * 9) / 16)]
      const spec =
        viewpoint === 'custom'
          ? { mode: 'viewport', from: args.from, look_at: args.look_at, lens: args.lens, ortho: args.ortho, ortho_scale: args.ortho_scale, width: dims[0], height: dims[1], shading: args.shading, overlays: args.overlays, diagnostics: args.diagnostics }
          : { mode: 'current', width: dims[0], height: dims[1] }
      const view = await c.view(spec, 180000)
      const saved = saveFrame(view.png, 'see-' + viewpoint + '-' + String(Date.now()) + '.png')
      try {
        await c.post('/lease', { action: 'update_view', sessionId, view: viewpoint === 'custom' ? { viewpoint: 'custom', from: args.from, lookAt: args.look_at, lens: args.lens } : { viewpoint: 'viewport', followUser: true } }, 5000)
      } catch {
        /* presence is observational */
      }
      return {
        ok: true,
        text: 'SEE ' + viewpoint + ' · ' + String(saved.width) + 'x' + String(saved.height) + ' · ' + String(saved.bytes) + 'B · sha256 ' + saved.sha256.slice(0, 16),
        image_path: saved.file,
        image: saved,
        meta: view.meta,
      }
    },
  }

  // -------------------------------------------------------------------- run
  const RENDER_KEYS = ['file', 'output', 'outdir', 'frames', 'resolution', 'samples', 'engine', 'format', 'camera']
  const HEADLESS_KEYS = [
    'script',
    'script_file',
    'file',
    'outdir',
    'timeout_ms',
    'engine',
    'preload',
    'factory_startup',
    'bootstrap',
    'workdir',
    'include_noise',
    'out_json',
    'args',
    'env',
    'shots',
    'expect',
    'hard_exit',
    'gpu',
    'run_id',
  ]
  const RUN_ACTIONS = ['submit', 'status', 'wait', 'collect', 'cancel', 'list', 'perf', 'tune', 'help']

  const runTool = {
    name: 'blender_run',
    risk: 'high',
    description:
      '[v3.1] 唯一作业入口：submit 立即返回 jobId（无同步模式），之后 status/wait/collect/cancel/list/perf。' +
      'kind=render 是声明式最终渲染（相机/帧区间/分辨率/采样/引擎/输出；不接受 script）；kind=headless 是 fresh blender -b 跑脚本（script/script_file/file/outdir/timeout_ms/preload/args/env）。' +
      '队列有界（pending 64、GPU 1、CPU 2），满队列返回 QUEUE_FULL；wait 默认 120s、上限 600s，超时不取消作业。' +
      'headless 由本机 Blender 可执行文件子进程执行，日志与产物在作业目录里；collect 取日志尾部与产物清单。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: RUN_ACTIONS, description: '默认：带 kind 则 submit，否则 list' },
        kind: { type: 'string', enum: ['render', 'headless'], description: 'submit 的作业类型' },
        id: { type: 'string', description: 'status/wait/collect/cancel 的 jobId' },
        priority: { type: 'integer', description: 'submit 队列优先级 -100..100' },
        timeout_ms: { type: 'integer', description: 'wait 上限（≤600000）；headless 进程上限' },
        tail: { type: 'integer', description: 'collect 日志尾部字符数，默认 4000' },
        state: { type: 'string', description: 'list 状态过滤' },
        owner: { type: 'string', description: 'list 会话过滤' },
        file: { type: 'string', description: 'render：.blend 路径；headless：可选 .blend' },
        output: { type: 'string', description: 'render 输出文件模板' },
        outdir: { type: 'string', description: 'render/headless 输出目录' },
        frames: { type: 'string', description: 'render 帧区间 [start,end] 或 "1-10"' },
        resolution: { type: 'string', description: 'render [width,height]' },
        samples: { type: 'integer', description: 'render 采样数' },
        engine: { type: 'string', description: '渲染引擎（CYCLES / BLENDER_EEVEE_NEXT / BLENDER_WORKBENCH）' },
        format: { type: 'string', description: 'render 图片格式（PNG/JPEG/OPEN_EXR…）' },
        camera: { type: 'string', description: 'render 相机名或 true' },
        script: { type: 'string', description: 'headless Python 脚本内容' },
        script_file: { type: 'string', description: 'headless 磁盘 .py 路径' },
        preload: { type: 'string', description: 'headless 预载模块（逗号分隔）' },
        factory_startup: { type: 'boolean', description: 'headless --factory-startup（默认 true）' },
        bootstrap: { type: 'boolean', description: 'headless 注入持久内核 K（默认 true）' },
        workdir: { type: 'string', description: 'headless chdir + sys.path 首位' },
        include_noise: { type: 'boolean', description: 'headless 产物清单含噪音文件' },
        out_json: { type: 'string', description: 'headless 结构化结果落盘路径' },
        args: { type: 'string', description: 'headless 追加到 -- 之后的参数；tune 参数对象' },
        env: { type: 'string', description: 'headless 子进程环境变量 JSON {KEY:"VALUE"}' },
        op: { type: 'string', enum: ['status', 'analyze', 'apply', 'revert', 'help'], description: 'tune 子动作' },
      },
      required: [],
    },
    async execute(rawArgs, ctx) {
      const args = jsonPayload(rawArgs)
      const c = client(ctx)
      const action = text(args.action).trim() || (present(args.kind) ? 'submit' : 'list')
      if (action === 'help')
        return {
          ok: true,
          text: [
            'blender_run:',
            '  submit kind=render|headless  (立即返回 jobId)',
            '  status|wait|collect|cancel id=<jobId>',
            '  list [state=...]  |  perf  |  tune op=status|analyze|apply|revert',
          ].join('\n'),
        }
      if (!RUN_ACTIONS.includes(action)) return fail('invalid_params', '未知 blender_run action：' + action, '可用：' + RUN_ACTIONS.join(' | '))
      if (action === 'tune') {
        const op = text(args.op).trim() || 'status'
        const pargs = jsonPayload(args.args)
        const body = await c.post('/perf', { op, args: Object.keys(pargs).length ? pargs : undefined }, 600000)
        if (body.ok !== true) return failFromBody(body, 'RUN tune ' + op)
        return { ok: true, text: 'RUN tune ' + op + ' ok', result: body.result !== undefined ? body.result : body }
      }
      const queue = (payload, timeoutMs) =>
        c.post('/job', { surface: 'queue', ...payload }, timeoutMs)
      if (action === 'submit') {
        const kind = text(args.kind).trim()
        if (kind !== 'render' && kind !== 'headless')
          return fail('invalid_params', 'submit 需要 kind=render|headless', 'render=声明式最终渲染；headless=跑脚本')
        const payload = { op: 'submit', kind }
        if (present(args.priority)) payload.priority = Number(args.priority)
        if (kind === 'render') {
          if (present(args.script) || present(args.script_file))
            return fail('invalid_params', 'render 不接受 script/script_file', '跑脚本用 kind=headless 或 blender_py')
          for (const key of RENDER_KEYS) if (present(args[key])) payload[key] = args[key]
        } else {
          if (!present(args.script) && !present(args.script_file) && !present(args.file))
            return fail('invalid_params', 'headless 需要 script / script_file / file 之一', '给一段脚本或一个 .blend')
          // `env` is a JSON object upstream; accept it as object or JSON string.
          for (const key of HEADLESS_KEYS)
            if (present(args[key])) payload[key] = key === 'env' ? jsonPayload(args[key]) : args[key]
        }
        const body = await queue(payload, 60000)
        if (body.ok !== true) return failFromBody(body, 'RUN submit')
        const job = isRecord(body.job) ? body.job : {}
        return {
          ok: true,
          text: 'RUN submit ok · jobId=' + text(job.id || body.id) + ' · state=' + text(job.state || body.state || 'queued'),
          job,
        }
      }
      if (action === 'list') {
        const payload = { op: 'list' }
        for (const key of ['state', 'kind', 'owner']) if (present(args[key])) payload[key] = args[key]
        const body = await queue(payload, 60000)
        if (body.ok !== true) return failFromBody(body, 'RUN list')
        const jobs = Array.isArray(body.jobs) ? body.jobs : []
        return {
          ok: true,
          text: jobs.length
            ? jobs.map((job) => '- ' + text(job.id) + ' · ' + text(job.kind) + ' · ' + text(job.state) + ' · ' + text(job.createdAt || '')).join('\n')
            : '（队列为空）',
          jobs,
        }
      }
      if (action === 'perf') {
        const body = await queue({ op: 'perf' }, 60000)
        if (body.ok !== true) return failFromBody(body, 'RUN perf')
        return { ok: true, text: 'RUN perf ok', perf: body.perf || {} }
      }
      if (!present(args.id)) return fail('invalid_params', action + ' 需要 id（jobId）', '先 action=submit 或 action=list')
      const id = text(args.id)
      if (action === 'status') {
        const body = await queue({ op: 'status', id }, 60000)
        if (body.ok !== true) return failFromBody(body, 'RUN status')
        const job = isRecord(body.job) ? body.job : {}
        return { ok: true, text: 'RUN status · ' + text(job.state) + ' · id=' + id, job }
      }
      if (action === 'wait') {
        const timeoutMs = Number(args.timeout_ms) || 120000
        const budget = Math.min(600000, Math.max(1000, timeoutMs)) + 30000
        const body = await queue({ op: 'wait', id, timeout_ms: timeoutMs }, budget)
        if (body.ok !== true) return failFromBody(body, 'RUN wait')
        const job = isRecord(body.job) ? body.job : {}
        return {
          ok: true,
          text: 'RUN wait · ' + text(job.state) + ' · waitedMs=' + String(body.waitedMs || 0) + (body.waitTimedOut ? ' · 超时未完成（作业仍在跑）' : ''),
          job,
          waitedMs: body.waitedMs,
          waitTimedOut: body.waitTimedOut === true,
        }
      }
      if (action === 'collect') {
        const body = await queue({ op: 'collect', id, tail: Number(args.tail) || 4000 }, 60000)
        if (body.ok !== true) return failFromBody(body, 'RUN collect')
        const job = isRecord(body.job) ? body.job : {}
        // The queue surface keeps logs under job.logs.{stdout,stderr} and the
        // artifact list under job.artifacts; the tail budget applies to both.
        const tail = Number(args.tail) || 4000
        const logs = isRecord(job.logs) ? job.logs : {}
        const stdout = text(logs.stdout || '')
        const stderr = text(logs.stderr || '')
        const log = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).slice(-tail)
        const artifacts = Array.isArray(job.artifacts) ? job.artifacts : []
        return {
          ok: true,
          text:
            'RUN collect · ' + text(job.state) + ' · id=' + id +
            ' · artifacts=' + String(artifacts.length) +
            (log ? '\n--- log tail ---\n' + log : ''),
          job,
          log,
          artifacts,
        }
      }
      const body = await queue({ op: 'cancel', id }, 60000)
      if (body.ok !== true) return failFromBody(body, 'RUN cancel')
      return { ok: true, text: 'RUN cancel ok · id=' + id, result: body }
    },
  }

  // ---------------------------------------------------------------- inspect
  const inspectTool = {
    name: 'blender_inspect',
    risk: 'low',
    description:
      '[v3.1] 只读检查：列出 addon 可执行只读命令（command=help），并执行 command=<name> args={...}。' +
      '写命令/下载命令/内部传输命令已从模型面删除，误用时返回 wrong_tool 提示。命令面真源是 addon command registry（25 registered / 26 wire）。',
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '只读命令名；缺省 help 列出全部' },
        args: { type: 'string', description: '命令参数 JSON 对象，例如 {"name":"Cube"}' },
      },
      required: [],
    },
    async execute(rawArgs, ctx) {
      const args = jsonPayload(rawArgs)
      const c = client(ctx)
      const command = text(args.command).trim() || 'help'
      let body
      try {
        body = await c.get('/commands', 45000)
      } catch (error) {
        return fail('addon_unreachable', 'INSPECT ' + command + ' 失败 · ' + text(error && error.message), '先切回 Blender N 面板点 Connect；再 blender_session action=doctor')
      }
      // No addon attached: /commands answers ok:false + a structured transport
      // failure instead of a command list. That is an error, not an empty list.
      if (body.ok === false && !Array.isArray(body.commands)) {
        const failure = failFromBody(body, 'INSPECT ' + command)
        return { ...failure, code: 'addon_unreachable' }
      }
      const rows = Array.isArray(body.commands) ? body.commands.filter(isRecord) : []
      if (command === 'help') {
        return {
          ok: true,
          text:
            'commands=' + String(rows.length) +
            '\n' + rows.map((row) => '- ' + text(row.name) + ' [' + text(row.access) + ']' + (row.enabled === false ? ' (disabled)' : '')).join('\n'),
          scene: body.scene,
          file: body.file,
          commands: rows,
        }
      }
      const wrong = WRONG_TOOL[command]
      if (wrong) {
        return fail(
          'wrong_tool',
          'INSPECT ' + command + ' 不是只读模型命令（' + wrong[1] + '）',
          wrong[0] === 'none' ? '没有替代工具' : '改用 ' + wrong[0],
        )
      }
      const row = rows.find((item) => text(item.name) === command)
      if (!row) {
        if (command === 'ping') return fail('unknown_command', 'ping 只是 wire 级 liveness 探测', '连通性用 blender_session action=status')
        const near = rows
          .filter((item) => text(item.access) === 'read')
          .map((item) => text(item.name))
          .filter((name) => name.startsWith(command.slice(0, 3)))
          .slice(0, 3)
        return fail('unknown_command', 'INSPECT 未知命令：' + command, near.length ? 'did_you_mean: ' + near.join(', ') : 'command=help 看列表')
      }
      if (text(row.access) === 'internal') return fail('wrong_tool', 'INSPECT ' + command + ' 是内部传输命令', '不面向模型')
      if (row.enabled === false) return fail('command_disabled', 'INSPECT ' + command + ' 被集成开关挡住（' + text(row.gate) + '）', '在 Blender N 面板打开对应集成开关')
      const params = jsonPayload(args.args)
      const result = await c.post('/cmd', { name: command, params, timeoutMs: 120000 }, 300000)
      if (result.error === 'leased') return fail('lease_conflict', leasedText(result), '等当前写操作结束或 release 后重试')
      if (result.ok !== true) return failFromBody(result, 'INSPECT ' + command)
      return { ok: true, text: 'INSPECT ' + command + ' ok · ms=' + text(result.ms || ''), result: result.result !== undefined ? result.result : result }
    },
  }

  // One uniform transport boundary: a Gateway that is down (or a cancelled
  // wait) becomes a structured failure with a real next step instead of an
  // exception escaping to the host.
  const guarded = [sessionTool, opTool, pyTool, seeTool, runTool, inspectTool].map((tool) => ({
    ...tool,
    async execute(rawArgs, ctx) {
      try {
        return await tool.execute(rawArgs, ctx)
      } catch (error) {
        if (error && error.code === 'aborted') {
          return fail(
            'aborted',
            String(error.message || 'aborted'),
            '重试；注意 bpy 侧的执行/作业不会因为本地取消而停止',
          )
        }
        return fail(
          'gateway_unreachable',
          tool.name + ' 失败 · ' + text(error && error.message),
          '在命令面板运行「Blender Bridge: 状态」确认 Gateway；必要时运行「Blender Bridge: 重启 Gateway」',
        )
      }
    },
  }))
  return guarded
}

function leasedText(body) {
  return (
    '写通道被别的会话占用（holder=' +
    text(body.holder) +
    '，剩余 ' +
    String(Math.round(Number(body.expiresInMs || 0) / 1000)) +
    's）。' +
    text(body.hint)
  )
}

function failFromBody(body, what) {
  // Stable code: prefer the Gateway's own token; otherwise use a bare error
  // token, otherwise classify by stage. The human message never becomes a code.
  const declared = text(body.code)
  const bareToken = /^[a-z][a-z0-9_]*$/.test(text(body.error)) ? text(body.error) : ''
  const code = declared || bareToken || (text(body.stage) === 'transport' ? 'addon_unreachable' : 'backend_error')
  const root = text(body.root_cause || body.error || 'unknown')
  const fix = text(body.fix || body.hint || '先 blender_session action=doctor 看 Gateway/addon 状态')
  return {
    ok: false,
    code,
    text: what + ' 失败 · ' + root,
    fix,
    ...(body.stage ? { stage: body.stage } : {}),
    ...(body.evidence ? { evidence: body.evidence } : {}),
    status: body.__status,
  }
}

module.exports = { makeTools, DEFAULT_PORT, TOKEN_HEADER, READ_ONLY_OPS, pruneFrames, FRAME_CACHE }
