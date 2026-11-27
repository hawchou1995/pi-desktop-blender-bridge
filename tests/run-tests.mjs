#!/usr/bin/env node
/**
 * Verification harness for the PI Blender Bridge candidate.
 *
 * Runs the REAL pieces, no mocks:
 *   - the real Gateway (vendor/dsh-runtime, protocol 12) through bridge/proc.cjs,
 *     exactly as main.js starts it;
 *   - the real six tool descriptors from bridge/tools.cjs;
 *   - the real addon-independent routes (/health /lease /status /doctor);
 *   - a real `blender -b` headless job through /job (submit → wait → collect).
 *
 * Usage:
 *   node tests/run-tests.mjs            # full run, needs Blender
 *   node tests/run-tests.mjs --no-blender
 * Env: DSH_BLENDER_EXE (optional), PI_BRIDGE_TEST_PORT (default 39897)
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import net from 'node:net'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const { GatewaySupervisor } = require(path.join(ROOT, 'bridge', 'proc.cjs'))
const { GatewayClient } = require(path.join(ROOT, 'bridge', 'client.cjs'))
const { makeTools } = require(path.join(ROOT, 'bridge', 'tools.cjs'))

const PORT = Number(process.env.PI_BRIDGE_TEST_PORT || 39897)
const NO_BLENDER = process.argv.includes('--no-blender')
const BLENDER = process.env.DSH_BLENDER_EXE || ''
const RUN_ROOT = path.join(process.env.PI_SCRATCH_DIR || path.join(ROOT, 'build'), 'bridge-test')
const DATA_DIR = path.join(RUN_ROOT, 'data')
const OUT_DIR = path.join(RUN_ROOT, 'out')

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : ''))
}

function assert(name, condition, detail) {
  record(name, !!condition, detail)
  return !!condition
}

fs.rmSync(RUN_ROOT, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const PAIRING = 'run-tests-pairing-token-0123456789'
const supervisor = new GatewaySupervisor({
  pluginDir: ROOT,
  dataDir: DATA_DIR,
  settings: { gatewayPort: PORT, blenderExe: BLENDER, autoStart: true },
  addonToken: PAIRING,
})

let info
try {
  info = await supervisor.start()
} catch (error) {
  record('gateway.start', false, String(error && error.message))
  console.error('STOPPED: gateway did not start; see ' + path.join(DATA_DIR, 'logs', 'gateway.log'))
  process.exit(1)
}
record('gateway.start', info.ok === true, 'pid=' + String(info.pid) + ' port=' + String(info.port))
assert('gateway.binds-loopback', String(info.host) === '127.0.0.1', 'host=' + info.host)
assert('gateway.route-contract-29', Array.isArray(info.routes) && info.routes.length === 29, 'routes=' + String(info.routes.length))
assert('gateway.addon-endpoint', String(info.addonEndpoint).endsWith(':' + String(PORT) + '/addon'), info.addonEndpoint)

const client = new GatewayClient({ port: PORT, token: supervisor.token, holder: 'pi-desktop', caller: { sessionId: 'test-session' } })

// --- token gate: an anonymous loopback caller must be refused -----------------
{
  const anonymous = new GatewayClient({ port: PORT, token: 'wrong-token-wrong-token', holder: 'x' })
  let status = 0
  let body = ''
  try {
    const res = await anonymous.request('GET', '/health')
    status = res.status
    body = res.buffer.toString('utf8')
  } catch (error) {
    status = -1
    body = String(error && error.message)
  }
  assert('security.anonymous-http-refused', status === 403 && body.includes('bridge_token_required'), 'status=' + String(status))
}

// --- /addon pairing gate: a dialer with a missing or wrong secret is refused --
// (Only the reject cases are exercised here; the accepted path is the real
// addon in tests/gui-integration.mjs — this suite never impersonates one.)
function attemptAddonUpgrade(headerLine) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: '127.0.0.1' })
    let buffered = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* already closed */
      }
      resolve(value)
    }
    socket.setTimeout(5000)
    socket.on('connect', () => {
      const key = Buffer.from('0123456789abcdef').toString('base64')
      socket.write(
        'GET /addon HTTP/1.1\r\n' +
          'Host: 127.0.0.1:' + String(PORT) + '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          (headerLine || '') +
          '\r\n',
      )
    })
    socket.on('data', (chunk) => {
      buffered += String(chunk)
      if (buffered.includes('\r\n\r\n')) finish(buffered.split('\r\n')[0])
    })
    socket.on('timeout', () => finish('timeout'))
    socket.on('error', (error) => finish('error:' + String(error && error.code)))
    socket.on('close', () => finish(buffered.split('\r\n')[0] || 'closed'))
  })
}

{
  const missing = await attemptAddonUpgrade('')
  assert('security.addon-upgrade-refused-without-secret', missing.includes('403'), missing)
  const wrong = await attemptAddonUpgrade('x-dsh-bridge-token: not-the-pairing-code\r\n')
  assert('security.addon-upgrade-refused-with-wrong-secret', wrong.includes('403'), wrong)
  // Browser-origin refusal is enforced in the same gate; it is asserted here
  // with a wrong secret so this suite still never dials with the real one.
  const withOrigin = await attemptAddonUpgrade('x-dsh-bridge-token: wrong-secret\r\norigin: https://example.com\r\n')
  assert('security.addon-upgrade-refused-with-origin', withOrigin.includes('403'), withOrigin)
}

// --- health / status / doctor ------------------------------------------------
const health = await client.get('/health', 15000)
assert('health.ok', health.ok === true, 'pid=' + String(health.backend && health.backend.pid))
const provenance = health.provenance || {}
assert('catalog.families-34', Number(provenance.families) === 34, 'families=' + String(provenance.families))
assert('catalog.ops-228', Number(provenance.opsCount) === 228, 'ops=' + String(provenance.opsCount))
assert('catalog.addon-commands-25', Number(provenance.commandCatalogKeys) === 25, 'commands=' + String(provenance.commandCatalogKeys))
assert('catalog.tool-detail-keys-6', Number(provenance.toolDetailKeys) === 6, 'keys=' + String(provenance.toolDetailKeys))

const status = await client.get('/status', 20000)
assert('status.route', status.__status === 200, 'http=' + String(status.__status))
const doctor = await client.get('/doctor', 60000)
record(
  'doctor.diagnosis',
  typeof (doctor.addon && doctor.addon.kind) === 'string',
  'addon=' + String(doctor.addon && doctor.addon.kind) +
    ' ready=' + String(doctor.readiness && doctor.readiness.ready) +
    ' gatewayLive=' + String(doctor.readiness && doctor.readiness.gateway && doctor.readiness.gateway.live),
)

// --- the six tools exist with upstream names ---------------------------------
const tools = makeTools({ settings: { gatewayPort: PORT }, dataDir: DATA_DIR, getToken: () => supervisor.token })
const names = tools.map((tool) => tool.name)
const expected = ['blender_session', 'blender_op', 'blender_py', 'blender_see', 'blender_run', 'blender_inspect']
assert('tools.six-names', JSON.stringify(names) === JSON.stringify(expected), names.join(','))

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
const declared = (manifest.contributes.agentTools || []).map((tool) => tool.name)
assert('manifest.agentTools-match-runtime', JSON.stringify(declared) === JSON.stringify(names), declared.join(','))
// Contract parity: same property names, same JSON type, same enum, same
// required list. Prose (description) is deliberately allowed to differ — the
// runtime descriptors carry the upstream wording, the manifest keeps them short.
let schemaMismatch = ''
for (const tool of tools) {
  const row = (manifest.contributes.agentTools || []).find((item) => item.name === tool.name)
  if (!row) {
    schemaMismatch = tool.name + ':missing'
    break
  }
  const a = tool.schema.properties || {}
  const b = row.schema.properties || {}
  const keysA = Object.keys(a).sort()
  const keysB = Object.keys(b).sort()
  if (JSON.stringify(keysA) !== JSON.stringify(keysB)) {
    schemaMismatch = tool.name + ':property-names ' + keysA.join('/') + ' vs ' + keysB.join('/')
    break
  }
  for (const key of keysA) {
    if (String(a[key].type) !== String(b[key].type)) {
      schemaMismatch = tool.name + '.' + key + ':type'
      break
    }
    if (JSON.stringify(a[key].enum || null) !== JSON.stringify(b[key].enum || null)) {
      schemaMismatch = tool.name + '.' + key + ':enum'
      break
    }
  }
  if (schemaMismatch) break
  if (JSON.stringify(row.schema.required || []) !== JSON.stringify(tool.schema.required || [])) {
    schemaMismatch = tool.name + ':required'
    break
  }
}
assert('manifest.schemas-match-runtime', schemaMismatch === '', schemaMismatch || 'six schemas match on names/type/enum/required')

const manifestPermissions = manifest.permissions || []
assert(
  'manifest.least-privilege',
  JSON.stringify(manifestPermissions.slice().sort()) ===
    JSON.stringify(['agent.prompt.inject', 'agent.tool.register', 'ui.panel']),
  manifestPermissions.join(','),
)

// --- tool calls against the live Gateway -------------------------------------
const ctx = { sessionId: 'test-session', turnId: 'turn-1' }
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))

{
  const listed = await byName.blender_session.execute({ action: 'list' }, ctx)
  assert('session.list', listed.ok === true && Array.isArray(listed.sessions), 'sessions=' + String((listed.sessions || []).length))
}
{
  const help = await byName.blender_op.execute({ action: 'help' }, ctx)
  assert('op.help', help.ok === true && help.text.includes('228'))
}
{
  const bad = await byName.blender_op.execute({ action: 'plan', op: 'audit_scene', args: '{not json' }, ctx)
  assert('op.invalid-args', bad.ok === false && bad.code === 'invalid_params', 'code=' + String(bad.code))
}
{
  const inspect = await byName.blender_inspect.execute({ command: 'help' }, ctx)
  // No addon attached: /commands must fail as addon_unreachable, not crash.
  assert('inspect.no-addon-error', inspect.ok === false && inspect.code === 'addon_unreachable', 'code=' + String(inspect.code))
}
{
  const see = await byName.blender_see.execute({ viewpoint: 'viewport' }, ctx)
  assert('see.requires-session', see.ok === false && see.code === 'session_required', 'code=' + String(see.code))
}
{
  const py = await byName.blender_py.execute({ code: 'print(1)' }, ctx)
  assert('py.requires-session', py.ok === false && py.code === 'session_required', 'code=' + String(py.code))
}

// --- real headless job: submit -> wait -> collect ----------------------------
let jobId = ''
if (!NO_BLENDER) {
  const exists = fs.existsSync(BLENDER)
  assert('blender.binary-present', exists, BLENDER)
  if (exists) {
    const probe = spawnSync(BLENDER, ['--version'], { encoding: 'utf8', timeout: 60000 })
    const version = (probe.stdout || '').split('\n')[0].trim()
    record('blender.version', probe.status === 0 && /^Blender \d/.test(version), version)

    // The queue surface owns the child environment (runtime/core/queue keeps a
    // fixed env), so the absolute output path is baked into the script instead
    // of relying on env or sys.argv.
    const outFile = path.join(OUT_DIR, 'bridge-test.png').replace(/\\/g, '/')
    const script = [
      'import bpy, os',
      'outfile = ' + JSON.stringify(outFile),
      'os.makedirs(os.path.dirname(outfile), exist_ok=True)',
      'scene = bpy.context.scene',
      'scene.render.engine = "BLENDER_WORKBENCH"',
      'scene.render.resolution_x = 96',
      'scene.render.resolution_y = 64',
      'scene.render.resolution_percentage = 100',
      'scene.render.image_settings.file_format = "PNG"',
      'scene.render.filepath = outfile',
      'bpy.ops.mesh.primitive_cube_add(size=1.0)',
      'bpy.ops.render.render(write_still=True)',
      'print("BRIDGE_TEST_OK exists:", os.path.exists(outfile), "size:", os.path.getsize(outfile))',
    ].join('\n')
    const submit = await byName.blender_run.execute(
      {
        action: 'submit',
        kind: 'headless',
        script,
        env: JSON.stringify({ PI_BRIDGE_TEST_OUTDIR: OUT_DIR }),
        outdir: OUT_DIR,
        workdir: OUT_DIR,
        include_noise: true,
        timeout_ms: 300000,
      },
      ctx,
    )
    jobId = (submit.job && submit.job.id) || ''
    assert('run.submit-headless', submit.ok === true && !!jobId, 'jobId=' + jobId)

    if (jobId) {
      const wait = await byName.blender_run.execute({ action: 'wait', id: jobId, timeout_ms: 240000 }, ctx)
      const state = String((wait.job && (wait.job.state || wait.job.status)) || '')
      assert('run.wait-completed', wait.ok === true && /complete|succeed|done/i.test(state), 'state=' + state)

      const collect = await byName.blender_run.execute({ action: 'collect', id: jobId, tail: 6000 }, ctx)
      const log = String(collect.log || '')
      assert('run.collect-log', collect.ok === true && log.length > 0, 'logChars=' + String(log.length))
      assert('run.log-marker', log.includes('BRIDGE_TEST_OK'), log.split('\n').filter((l) => l.includes('BRIDGE_TEST_OK')).join(' | ').slice(0, 200))
      const png = path.join(OUT_DIR, 'bridge-test.png')
      const rendered = fs.existsSync(png)
      assert('run.render-artifact', rendered, rendered ? png + ' · ' + String(fs.statSync(png).size) + 'B' : 'missing ' + png)
      fs.copyFileSync(path.join(DATA_DIR, 'logs', 'gateway.log'), path.join(RUN_ROOT, 'gateway.log'))
      fs.writeFileSync(path.join(RUN_ROOT, 'job-collect.json'), JSON.stringify(collect, null, 2))
    }
  }
}

await supervisor.stop()
const afterStop = await new Promise((resolve) => setTimeout(() => resolve(true), 500))
assert('gateway.stop', supervisor.info === null && afterStop, 'supervisor.info cleared')

// --- summary -----------------------------------------------------------------
const failed = results.filter((item) => !item.ok)
const summary = {
  ranAt: new Date().toISOString(),
  port: PORT,
  blender: NO_BLENDER ? 'skipped' : BLENDER,
  jobId,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}
fs.writeFileSync(path.join(RUN_ROOT, 'results.json'), JSON.stringify(summary, null, 2))
console.log('\n' + String(results.length - failed.length) + ' passed, ' + String(failed.length) + ' failed · results ' + path.join(RUN_ROOT, 'results.json'))
process.exit(failed.length === 0 ? 0 : 1)
