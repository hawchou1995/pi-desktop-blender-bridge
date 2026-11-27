#!/usr/bin/env node
/**
 * GUI round-trip against a real, isolated Blender 5.3.
 *
 * Isolation: the whole run uses BLENDER_USER_RESOURCES pointed at the scratch
 * directory, so the user's own Blender config, addons (including the unrelated
 * `blender_mcp` addon) and startup files are untouched. The only process this
 * script starts/ends is the Blender instance it launched itself.
 *
 * Scope: install the addon zip built from the pinned source, let the addon dial
 * the Gateway (protocol 12), then exercise doctor / inspect / py / see through
 * the same bridge/tools.cjs the PI plugin registers.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const { GatewaySupervisor } = require(path.join(ROOT, 'bridge', 'proc.cjs'))
const { makeTools } = require(path.join(ROOT, 'bridge', 'tools.cjs'))

const PORT = Number(process.env.PI_BRIDGE_GUI_PORT || 39895)
const BLENDER = process.env.DSH_BLENDER_EXE || ''
const RUN_ROOT = path.join(process.env.PI_SCRATCH_DIR || path.join(ROOT, 'build'), 'gui-test')
const USER = path.join(RUN_ROOT, 'userdata')
const DATA = path.join(RUN_ROOT, 'data')
const ADDON = path.join(ROOT, 'addon', 'dsh_blender_bridge-2.0.0.zip')
const PAIRING = 'gui-pairing-token-0123456789'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : ''))
  return ok
}

fs.mkdirSync(USER, { recursive: true })
fs.mkdirSync(DATA, { recursive: true })

if (!fs.existsSync(BLENDER)) {
  record('blender.binary', false, BLENDER)
  process.exit(1)
}

const install = spawnSync(
  BLENDER,
  ['--command', 'extension', 'install-file', '-r', 'user_default', '-e', ADDON],
  { encoding: 'utf8', env: { ...process.env, BLENDER_USER_RESOURCES: USER }, timeout: 300000 },
)
record('addon.install-isolated', install.status === 0, (install.stdout || install.stderr || '').trim().slice(0, 300))

const supervisor = new GatewaySupervisor({
  pluginDir: ROOT,
  dataDir: DATA,
  settings: { gatewayPort: PORT, blenderExe: BLENDER },
  addonToken: PAIRING,
})
const info = await supervisor.start()
record('gateway.start', info.ok === true, 'port=' + String(info.port))

const tools = makeTools({ settings: { gatewayPort: PORT }, dataDir: DATA, getToken: () => supervisor.token })
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
const ctx = { sessionId: 'gui-test', turnId: 'turn-gui' }

const blenderLog = fs.openSync(path.join(RUN_ROOT, 'blender-gui.log'), 'a')
// Launch probe: in GUI Blender the addon's prints go to a detached console, so
// this script writes the connection state to a file and starts the server if the
// auto-start timer has not fired yet.
const probeLog = path.join(RUN_ROOT, 'blender-probe.log')
const probeScript = path.join(RUN_ROOT, 'probe.py')
fs.writeFileSync(
  probeScript,
  [
    'import bpy, os, traceback',
    'PROBE = os.environ.get("PI_GUI_PROBE_LOG", "")',
    'def log(msg):',
    '    try:',
    '        with open(PROBE, "a", encoding="utf-8") as f:',
    '            f.write(str(msg) + "\\n")',
    '    except Exception:',
    '        pass',
    'try:',
    '    log("probe " + bpy.app.version_string + " port=" + str(os.environ.get("DSHBB_GATEWAY_PORT")))',
    '    mod = __import__("bl_ext.user_default.dsh_blender_bridge.server", fromlist=["DSHBlenderBridgeServer"])',
    '    srv = getattr(bpy.types, "dshbb_server", None)',
    '    if srv is None:',
    '        srv = mod.DSHBlenderBridgeServer()',
    '        bpy.types.dshbb_server = srv',
    '    log("before start running=%s port=%s" % (srv.running, getattr(srv, "gateway_port", None)))',
    '    if not srv.running:',
    '        srv.start()',
    '    log("after start running=%s connected=%s port=%s err=%s" % (srv.running, srv.connected, getattr(srv, "gateway_port", None), getattr(srv, "handshake_error", "")))',
    'except Exception:',
    '    log(traceback.format_exc())',
    'def report():',
    '    try:',
    '        srv = getattr(bpy.types, "dshbb_server", None)',
    '        log("tick running=%s connected=%s err=%s" % (getattr(srv, "running", None), getattr(srv, "connected", None), getattr(srv, "handshake_error", "")))',
    '    except Exception:',
    '        log("tick failed")',
    '    return 3.0',
    'bpy.app.timers.register(report, first_interval=3.0)',
  ].join('\n'),
)
const child = spawn(BLENDER, ['-noaudio', '--python', probeScript], {
  env: {
    ...process.env,
    BLENDER_USER_RESOURCES: USER,
    DSHBB_GATEWAY_PORT: String(PORT),
    DSHBB_GATEWAY_HOST: '127.0.0.1',
    DSHBB_GATEWAY_TOKEN: PAIRING,
    PI_GUI_PROBE_LOG: probeLog,
  },
  stdio: ['ignore', blenderLog, blenderLog],
  windowsHide: false,
})
record('blender.gui-started', !!child.pid, 'pid=' + String(child.pid))

// The addon dials in as an *instance*; a session only becomes ready after the
// host attaches to it (upstream session registry contract). So: wait for a
// connected instance in /doctor, attach, then require a ready session row.
let instanceId = ''
let ready = null
let lastRows = []
const deadline = Date.now() + 120000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const doctor = await byName.blender_session.execute({ action: 'doctor' }, ctx)
  const body = doctor.doctor || {}
  const readiness = body.readiness || {}
  const instances = (body.addon && Array.isArray(body.addon.instances)) ? body.addon.instances : []
  instanceId = String(readiness.instanceId || (instances[0] && instances[0].instanceId) || '')
  if (!instanceId) continue
  await byName.blender_session.execute({ action: 'attach', instance_id: instanceId }, ctx)
  const listed = await byName.blender_session.execute({ action: 'list' }, ctx)
  lastRows = Array.isArray(listed.sessions) ? listed.sessions : []
  ready = lastRows.find((row) => String(row.status) === 'ready' && row.instanceId)
  if (ready) break
}
record(
  'session.ready',
  !!ready,
  ready
    ? 'instance=' + String(ready.instanceId) + ' kind=' + String(ready.kind) + ' id=' + String(ready.id)
    : 'no ready session; instanceId=' + (instanceId || 'none') + ' rows=' + JSON.stringify(lastRows).slice(0, 200),
)

if (ready) {
  const doctor = await byName.blender_session.execute({ action: 'doctor' }, ctx)
  record('doctor.kind-ok', doctor.ready === true, doctor.text.split('\n')[0])

  const inspect = await byName.blender_inspect.execute({ command: 'help' }, ctx)
  record('inspect.commands', inspect.ok === true && Array.isArray(inspect.commands), 'commands=' + String((inspect.commands || []).length))

  const scene = await byName.blender_inspect.execute({ command: 'get_scene_info', args: '{}' }, ctx)
  record('inspect.get_scene_info', scene.ok === true, scene.ok ? JSON.stringify(scene.result).slice(0, 160) : String(scene.text))

  const py = await byName.blender_py.execute(
    { code: 'import bpy\nprint("GUI_PROBE", len(bpy.data.objects), bpy.app.version_string)', see: false },
    ctx,
  )
  const pyOut = py.result || {}
  record(
    'py.kernel-exec',
    py.ok === true && (pyOut.executed === true || String(pyOut.stdout || '').includes('GUI_PROBE')),
    'ok=' + String(py.ok) + ' executed=' + String(pyOut.executed) +
      ' stdout=' + String(pyOut.stdout || '').trim().slice(0, 120) +
      ' text=' + String(py.text || '').slice(0, 200),
  )

  const see = await byName.blender_see.execute({ viewpoint: 'viewport', aspect: '16:9', max_size: 1024 }, ctx)
  const pngOk = see.ok === true && see.image_path && fs.existsSync(see.image_path)
  record('see.viewport-png', pngOk, pngOk ? see.image_path + ' · ' + String(see.image.width) + 'x' + String(see.image.height) + ' · ' + String(see.image.bytes) + 'B' : String(see.text))

  const camera = await byName.blender_see.execute({ viewpoint: 'camera', max_size: 768 }, ctx)
  record('see.camera-png', camera.ok === true && !!camera.image_path, camera.ok ? String(camera.image_path) : String(camera.text))

  const session = await byName.blender_session.execute({ action: 'attach', session_id: String(ready.id) }, ctx)
  record('session.attach', session.ok === true, session.text)
}

await supervisor.stop()
try {
  child.kill()
} catch {
  /* already gone */
}
await new Promise((resolve) => setTimeout(resolve, 1500))
try {
  if (child.exitCode === null) child.kill('SIGKILL')
} catch {
  /* already gone */
}

const failed = results.filter((item) => !item.ok)
fs.writeFileSync(
  path.join(RUN_ROOT, 'gui-results.json'),
  JSON.stringify({ ranAt: new Date().toISOString(), port: PORT, blender: BLENDER, userResources: USER, results }, null, 2),
)
console.log('\n' + String(results.length - failed.length) + ' passed, ' + String(failed.length) + ' failed · ' + path.join(RUN_ROOT, 'gui-results.json'))
process.exit(failed.length === 0 ? 0 : 1)
