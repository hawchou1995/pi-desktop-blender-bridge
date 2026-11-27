#!/usr/bin/env node
/**
 * Regression suite for the 3.1.3 review fixes (#5 session contract unification,
 * #2 log-stream lifecycle) plus the 3.1.2 set (#2–#8; #1 lives in run-tests.mjs
 * for the reject cases and in gui-integration.mjs for the real paired addon).
 *
 *   node tests/regressions.mjs
 *
 * Needs a Node >= 22 on PATH (or DSH_BLENDER_EXE for the stop-cancel section).
 * Writes results to $PI_SCRATCH_DIR/regressions/results.json.
 */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const { GatewaySupervisor } = require(path.join(ROOT, 'bridge', 'proc.cjs'))
const { GatewayClient } = require(path.join(ROOT, 'bridge', 'client.cjs'))
const { normalizePort, DEFAULT_GATEWAY_PORT } = require(path.join(ROOT, 'bridge', 'port.cjs'))
const { makeTools, pruneFrames } = require(path.join(ROOT, 'bridge', 'tools.cjs'))

const RUN_ROOT = path.join(process.env.PI_SCRATCH_DIR || path.join(ROOT, 'build'), 'regressions')
const DATA = path.join(RUN_ROOT, 'data')
const PORT = Number(process.env.PI_BRIDGE_REG_PORT || 39898)
const BLENDER = process.env.DSH_BLENDER_EXE || ''
const PAIRING = 'regression-pairing-token-0123456789'

fs.rmSync(RUN_ROOT, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + String(detail) : ''))
  return !!ok
}

function nodeProcessCount() {
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count"', {
      encoding: 'utf8',
      timeout: 30000,
    })
    return Number(String(out).trim()) || 0
  } catch {
    return -1
  }
}

// ---------------------------------------------------------------- #4 port
check('port.invalid-falls-back', normalizePort('abc') === DEFAULT_GATEWAY_PORT && normalizePort(70000) === DEFAULT_GATEWAY_PORT, 'default=' + DEFAULT_GATEWAY_PORT)
check('port.valid-kept', normalizePort(40123) === 40123 && normalizePort('39877') === 39877, '')
const supervisorInvalid = new GatewaySupervisor({ pluginDir: ROOT, dataDir: DATA, settings: { gatewayPort: 'nope' }, addonToken: PAIRING })
check('port.supervisor-uses-normalizer', supervisorInvalid.port === DEFAULT_GATEWAY_PORT, 'port=' + supervisorInvalid.port)
const toolsSource = fs.readFileSync(path.join(ROOT, 'bridge', 'tools.cjs'), 'utf8')
check(
  'port.tools-share-normalizer',
  toolsSource.includes("require('./port.cjs')") && toolsSource.includes('normalizePort(settings.gatewayPort)'),
  'tools.cjs uses the same module',
)

// ------------------------------------------------------------ #8 real hints
const mainSource = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
const titles = new Set((manifest.contributes.commands || []).map((command) => command.title))
const hinted = new Set()
for (const source of [toolsSource, mainSource]) {
  for (const match of source.matchAll(/Blender Bridge: [^'」"\n]+/g)) hinted.add(match[0].trim())
}
const unknownHints = [...hinted].filter((hint) => !titles.has(hint))
check('hints.point-at-real-commands', unknownHints.length === 0, unknownHints.length ? unknownHints.join(' | ') : 'all hints match manifest titles')
check('hints.no-ghost-start-command', !mainSource.includes('Blender Bridge: 启动 Gateway') && !toolsSource.includes('Blender Bridge: 启动 Gateway'), '')

// --------------------------------------------------------- #7 frame cache
{
  const dir = path.join(RUN_ROOT, 'frames')
  fs.mkdirSync(dir, { recursive: true })
  const write = (name, bytes, mtimeMs) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, Buffer.alloc(bytes, 1))
    fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs))
  }
  write('see-viewport-1.png', 10, 1000)
  write('see-camera-2.png', 10, 2000)
  write('py-see-3.png', 10, 3000)
  write('user-photo.png', 10, 4000)
  write('notes.txt', 10, 5000)
  const result = pruneFrames(dir, { maxFiles: 1, maxBytes: 1024 * 1024, prefixes: ['see-', 'py-see-'] })
  const left = fs.readdirSync(dir).sort()
  check(
    'frames.budget-only-own-files',
    result.removed === 2 && left.includes('py-see-3.png') && left.includes('user-photo.png') && left.includes('notes.txt'),
    'removed=' + result.removed + ' left=' + left.join(','),
  )
}

// ------------------------------------------------------- #6 abort semantics
{
  const supervisor = new GatewaySupervisor({ pluginDir: ROOT, dataDir: DATA, settings: { gatewayPort: PORT }, addonToken: PAIRING })
  await supervisor.start()
  const client = new GatewayClient({ port: PORT, token: supervisor.token, holder: 'pi-desktop' })
  const controller = new AbortController()
  controller.abort()
  const abortClient = new GatewayClient({ port: PORT, token: supervisor.token, holder: 'pi-desktop', signal: controller.signal })
  let abortCode = ''
  try {
    await abortClient.get('/health', 8000)
  } catch (error) {
    abortCode = String((error && error.code) || '')
  }
  check('abort.local-wait-only', abortCode === 'aborted', 'code=' + abortCode)
  const healthAfter = await client.get('/health', 8000)
  check('abort.does-not-kill-gateway', healthAfter.ok === true, 'gateway still healthy after an aborted wait')

  // #5 session contract, exercised against the real /plan|/loop|/opt|/preset
  // routes while no addon is connected (so no session can be ready anywhere).
  const ctx = { sessionId: 'regression', turnId: 't1' }
  const tools = makeTools({ settings: { gatewayPort: PORT }, dataDir: DATA, getToken: () => supervisor.token })
  const op = tools.find((tool) => tool.name === 'blender_op')
  // Genuinely session-free: the tool-local help path never touches the Gateway.
  const help = await op.execute({ action: 'help' }, ctx)
  check(
    'op.help-needs-no-session',
    help.ok === true && String(help.text || '').includes('会话契约'),
    'ok=' + String(help.ok),
  )
  // Read-only op: the adapter does not gate it, so the only failure left is the
  // missing addon (exact code, not just "not session_required").
  const readOnly = await op.execute({ action: 'plan', op: 'audit_scene' }, ctx)
  check(
    'op.readonly-no-session-gate',
    readOnly.ok === false && readOnly.code === 'addon_unreachable',
    'code=' + readOnly.code,
  )
  const write = await op.execute({ action: 'plan', op: 'sculpt_apply' }, ctx)
  check('op.write-needs-session', write.ok === false && write.code === 'session_required', 'code=' + write.code)
  // dry_run only tells the op to skip its writes; it still runs inside Blender,
  // so it must fail with the exact same session hint as the plain write path.
  const dry = await op.execute({ action: 'plan', op: 'sculpt_apply', args: '{"dry_run":true}' }, ctx)
  check(
    'op.write-dry-run-needs-session',
    dry.ok === false && dry.code === 'session_required',
    'code=' + dry.code,
  )
  check(
    'op.write-dry-run-same-hint',
    JSON.stringify(dry.choices || null) === JSON.stringify(write.choices || null) &&
      String(dry.fix || '') === String(write.fix || ''),
    'dry_run gets the same attach/start hint as a plain write op',
  )
  const loopGui = await op.execute({ action: 'loop', op: 'status' }, ctx)
  check('op.loop-gui-needs-session', loopGui.ok === false && loopGui.code === 'session_required', 'code=' + loopGui.code)
  const loopOpt = await op.execute({ action: 'opt', op: 'analyze' }, ctx)
  check('op.opt-needs-session', loopOpt.ok === false && loopOpt.code === 'session_required', 'code=' + loopOpt.code)
  const preset = await op.execute({ action: 'preset', op: 'list' }, ctx)
  check('op.preset-needs-session', preset.ok === false && preset.code === 'session_required', 'code=' + preset.code)
  // Upstream loop target=session runs on the persistent headless worker, so the
  // Upstream loop target=session runs on the persistent headless worker, so the
  // GUI gate is intentionally skipped there; without an addon the route itself
  // still cannot run, and the exact code is the transport one (never
  // session_required — that would mean the GUI gate leaked into this branch).
  const loopSession = await op.execute({ action: 'loop', op: 'status', target: 'session' }, ctx)
  check(
    'op.loop-session-target-no-gui-gate',
    loopSession.ok === false && loopSession.code === 'addon_unreachable',
    'code=' + loopSession.code,
  )
  await supervisor.stop()
}

// ------------------------------- #2 log stream lifecycle (proc.cjs:284-315)
{
  const supervisor = new GatewaySupervisor({ pluginDir: ROOT, dataDir: DATA, settings: { gatewayPort: PORT }, addonToken: PAIRING })
  await supervisor.start()
  const firstStream = supervisor.logStream
  check(
    'log.stream-open-after-start',
    !!firstStream && firstStream.writableEnded === false && firstStream.destroyed === false,
    'open=' + String(!!firstStream) + ' ended=' + String(firstStream && firstStream.writableEnded),
  )
  await supervisor.stop()
  const sizeAfterStop = fs.statSync(supervisor.logFile).size
  check(
    'log.stream-closed-after-stop',
    supervisor.logStream === null && !!firstStream && firstStream.writableEnded === true,
    'logStream=' + String(supervisor.logStream) + ' ended=' + String(firstStream && firstStream.writableEnded),
  )
  const headersAfterStop = (fs.readFileSync(supervisor.logFile, 'utf8').match(/^=== /gm) || []).length
  await supervisor.start()
  const secondStream = supervisor.logStream
  check(
    'log.restart-new-stream',
    !!secondStream && secondStream !== firstStream && secondStream.writableEnded === false,
    'fresh stream after restart, previous one stayed closed',
  )
  const headersAfterRestart = (fs.readFileSync(supervisor.logFile, 'utf8').match(/^=== /gm) || []).length
  check(
    'log.restart-appends',
    fs.statSync(supervisor.logFile).size > sizeAfterStop && headersAfterRestart === headersAfterStop + 1,
    'size ' + sizeAfterStop + ' -> ' + fs.statSync(supervisor.logFile).size + ', headers ' + headersAfterStop + ' -> ' + headersAfterRestart,
  )
  await supervisor.stop()
  check(
    'log.stream-closed-after-restart-stop',
    supervisor.logStream === null && !!secondStream && secondStream.writableEnded === true,
    'second lifetime stream ended, no dangling handle',
  )
}

// ------------------------------------- #2 failed start leaves nothing behind
{
  const holder = new GatewaySupervisor({ pluginDir: ROOT, dataDir: DATA, settings: { gatewayPort: PORT }, addonToken: PAIRING })
  await holder.start()
  const before = nodeProcessCount()
  const conflicted = new GatewaySupervisor({ pluginDir: ROOT, dataDir: DATA, settings: { gatewayPort: PORT }, addonToken: PAIRING })
  let message = ''
  try {
    await conflicted.start()
  } catch (error) {
    message = String(error && error.message)
  }
  const after = nodeProcessCount()
  check('start.port-conflict-rejects', /启动失败|清理子进程|提前退出/.test(message), message.slice(0, 160))
  check('start.port-conflict-no-leftover-handle', conflicted.child === null && conflicted.info === null, 'child=' + String(conflicted.child))
  check(
    'log.stream-closed-after-failed-start',
    conflicted.logStream === null && conflicted.logStream !== undefined,
    'logStream=' + String(conflicted.logStream) + ' (port conflict closed the stream)',
  )
  check('start.port-conflict-no-new-process', before < 0 || after <= before, 'node procs ' + before + ' -> ' + after)
  // The holder is still healthy and still owns the port.
  const holderClient = new GatewayClient({ port: PORT, token: holder.token, holder: 'pi-desktop' })
  const health = await holderClient.get('/health', 8000)
  check('start.port-conflict-holder-alive', health.ok === true, 'holder pid=' + String(health.backend && health.backend.pid))
  await holder.stop()
}

// ------------------------------- #2 ready-timeout path also cleans up
{
  // Deterministic timeout: a stub entry that never emits the ready line, so the
  // readiness budget always expires (the kill fallback is exercised too).
  const stub = path.join(RUN_ROOT, 'never-ready.mjs')
  fs.writeFileSync(stub, 'process.stdin.resume()\nsetInterval(() => {}, 1000)\n')
  const before = nodeProcessCount()
  const timeoutSupervisor = new GatewaySupervisor({
    pluginDir: ROOT,
    dataDir: DATA,
    settings: { gatewayPort: PORT + 1, readyTimeoutMs: 600 },
    addonToken: PAIRING,
    entryPath: stub,
  })
  let message = ''
  try {
    await timeoutSupervisor.start()
  } catch (error) {
    message = String(error && error.message)
  }
  const after = nodeProcessCount()
  check('start.timeout-rejects', /没有就绪/.test(message), message.slice(0, 160))
  check('start.timeout-cleaned', /已清理子进程/.test(message) && timeoutSupervisor.child === null, message.slice(-40))
  check('start.timeout-no-new-process', before < 0 || after <= before, 'node procs ' + before + ' -> ' + after)
  check(
    'log.stream-closed-after-timeout',
    timeoutSupervisor.logStream === null,
    'logStream=' + String(timeoutSupervisor.logStream) + ' (ready timeout closed the stream)',
  )
  // Port must be free again: a real entry starts on the same port afterwards.
  const retry = new GatewaySupervisor({ pluginDir: ROOT, dataDir: DATA, settings: { gatewayPort: PORT + 1 }, addonToken: PAIRING })
  let retryOk = false
  try {
    await retry.start()
    retryOk = true
  } catch (error) {
    retryOk = false
    console.log('      retry error: ' + String(error && error.message).slice(0, 120))
  }
  check('start.timeout-port-released', retryOk, 'second start on the same port')
  await retry.stop()
}

// ------------------------- #3 stop cancels an owned long headless job
if (BLENDER && fs.existsSync(BLENDER)) {
  const supervisor = new GatewaySupervisor({
    pluginDir: ROOT,
    dataDir: DATA,
    settings: { gatewayPort: PORT + 2, blenderExe: BLENDER, shutdownBudgetMs: 8000 },
    addonToken: PAIRING,
  })
  await supervisor.start()
  const tools = makeTools({ settings: { gatewayPort: PORT + 2 }, dataDir: DATA, getToken: () => supervisor.token })
  const run = tools.find((tool) => tool.name === 'blender_run')
  const ctx = { sessionId: 'regression', turnId: 't2' }
  const submit = await run.execute(
    { action: 'submit', kind: 'headless', script: 'import time\nprint("LONGJOB_START", flush=True)\ntime.sleep(180)\nprint("LONGJOB_END")', outdir: path.join(RUN_ROOT, 'job'), include_noise: true },
    ctx,
  )
  const jobId = (submit.job && submit.job.id) || ''
  check('stop.long-job-submitted', submit.ok === true && !!jobId, 'jobId=' + jobId)
  let pid = 0
  const deadline = Date.now() + 60000
  while (Date.now() < deadline && jobId) {
    const status = await run.execute({ action: 'status', id: jobId }, ctx)
    pid = Number(status.job && status.job.pid) || 0
    if (pid > 0 && String(status.job.state) === 'running') break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  check('stop.long-job-has-pid', pid > 0, 'pid=' + pid)
  const started = Date.now()
  const stopResult = await supervisor.stop()
  const elapsed = Date.now() - started
  const alive = (() => {
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })()
  check('stop.bounded', elapsed < 20000, 'elapsedMs=' + elapsed)
  check('stop.job-process-gone', pid > 0 && alive === false, 'pid=' + pid + ' alive=' + alive)
  check(
    'stop.report-lists-cancel',
    !!stopResult.report && Array.isArray(stopResult.report.canceled) && stopResult.report.canceled.some((item) => item.id === jobId),
    JSON.stringify(stopResult.report && stopResult.report.canceled || []).slice(0, 160),
  )
  const portOpen = await new Promise((resolve) => {
    const socket = require('node:net').connect({ port: PORT + 2, host: '127.0.0.1' })
    socket.setTimeout(1000)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
  check('stop.port-released', portOpen === false, 'connect to ' + (PORT + 2) + ' = ' + String(portOpen))
  const queueFile = path.join(DATA, 'rt', 'state', 'queue.json')
  let canceledState = ''
  try {
    const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'))
    canceledState = String((queue.jobs || []).find((job) => job.id === jobId)?.state || '')
  } catch {
    canceledState = 'queue.json missing'
  }
  check('stop.queue-marked-canceled', canceledState === 'canceled', 'state=' + canceledState)
} else {
  check('stop.long-job-skipped', false, 'set DSH_BLENDER_EXE to run the stop/cancel regression')
}

const failed = results.filter((item) => !item.ok)
fs.writeFileSync(path.join(RUN_ROOT, 'results.json'), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2))
console.log('\n' + String(results.length - failed.length) + ' passed, ' + String(failed.length) + ' failed · ' + path.join(RUN_ROOT, 'results.json'))
process.exit(failed.length === 0 ? 0 : 1)
