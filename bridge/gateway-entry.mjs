#!/usr/bin/env node
/**
 * PI-Desktop host adapter for the dsh-blender Gateway (protocol 12).
 *
 * This is the only file that starts the vendored Gateway. It is a *thin* host
 * boundary, not a fork: the server, the 29 routes, the addon WebSocket, the
 * session registry, the lease/scope layer, the job queue and the Python kernel
 * are all the vendored upstream runtime (vendor/dsh-runtime, pinned commit).
 *
 * What the adapter adds, and nothing else:
 *   1. a per-run bearer token on every HTTP route (upstream has no request auth;
 *      without it, any local process could drive /act and run Python in Blender);
 *   2. a loopback-only check on the /addon upgrade, refusal of browser origins,
 *      and a shared pairing secret carried in `x-dsh-bridge-token` — the addon
 *      sends it (see patches/addon-pairing-token.patch) and a dialer without the
 *      right secret is refused before the WebSocket upgrade;
 *   3. structured readiness/failure output on stdout for the parent plugin
 *      process, and a bounded, explicit shutdown: stop accepting requests,
 *      cancel the jobs this process owns, close, exit.
 *
 * Usage: node gateway-entry.mjs --port <n> --token <http-token> --addon-token <pairing-code>
 */
import crypto from 'node:crypto'
import { createGatewayApp } from '../vendor/dsh-runtime/lib/runtime/gateway/app.js'
import { startGateway } from '../vendor/dsh-runtime/lib/runtime/gateway/lifecycle.js'

const TOKEN_HEADER = 'x-pi-bridge-token'
/** Pairing header the addon sends on the WebSocket upgrade (never in the URL). */
const ADDON_TOKEN_HEADER = 'x-dsh-bridge-token'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function readFlag(argv, name) {
  const i = argv.indexOf('--' + name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function isLoopback(address) {
  return LOOPBACK.has(String(address || ''))
}

/** Refuse any HTTP request that does not carry this run's token. */
function installHttpTokenGate(server, token) {
  const handlers = server.listeners('request')
  server.removeAllListeners('request')
  server.on('request', (req, res) => {
    if (!isLoopback(req.socket && req.socket.remoteAddress)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'forbidden', code: 'non_loopback' }))
      return
    }
    const supplied = req.headers[TOKEN_HEADER]
    if (typeof supplied !== 'string' || !safeEqual(supplied, token)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: false,
          error: 'forbidden',
          code: 'bridge_token_required',
          hint:
            'The PI-Desktop Blender bridge only answers its own plugin process. ' +
            'Loopback callers without the per-run token in ' +
            TOKEN_HEADER +
            ' are refused.',
        }),
      )
      return
    }
    for (const handler of handlers) handler.call(server, req, res)
  })
}

/**
 * The addon dials ws://127.0.0.1:<port>/addon. Locality and browser-Origin are
 * necessary but not sufficient: without a shared secret any local process could
 * impersonate an instance. The addon therefore sends `x-dsh-bridge-token`
 * (patch: patches/addon-pairing-token.patch) and a dialer with a missing or
 * wrong secret is refused before the WebSocket upgrade completes. The secret is
 * never placed in the URL, never logged, and never returned by a tool.
 */
function installUpgradeGate(server, addonToken) {
  const handlers = server.listeners('upgrade')
  server.removeAllListeners('upgrade')
  server.on('upgrade', (req, socket, head) => {
    const path = String(req.url || '').split('?')[0]
    const origin = req.headers.origin
    const supplied = req.headers[ADDON_TOKEN_HEADER]
    const tokenOk = typeof supplied === 'string' && supplied.length > 0 && safeEqual(supplied, addonToken)
    if (!isLoopback(socket.remoteAddress) || path !== '/addon' || origin || !tokenOk) {
      // Same opaque response for every refusal: no oracle for which check failed.
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    for (const handler of handlers) handler.call(server, req, socket, head)
  })
}

const argv = process.argv.slice(2)
const port = Number(readFlag(argv, 'port'))
const token = readFlag(argv, 'token')
const addonToken = readFlag(argv, 'addon-token')
const shutdownBudgetMs = Number(readFlag(argv, 'shutdown-ms')) || 8000
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  emit({ ok: false, code: 'bad_port', message: 'gateway-entry: --port <0-65535> is required' })
  process.exit(2)
}
if (!token || token.length < 16) {
  emit({ ok: false, code: 'bad_token', message: 'gateway-entry: --token <>=16 chars> is required' })
  process.exit(2)
}
if (!addonToken || addonToken.length < 8) {
  emit({
    ok: false,
    code: 'bad_addon_token',
    message: 'gateway-entry: --addon-token <>=8 chars> is required (pairing secret for /addon)',
  })
  process.exit(2)
}

let app
try {
  app = createGatewayApp({ port, host: '127.0.0.1' })
  installHttpTokenGate(app.server, token)
  installUpgradeGate(app.server, addonToken)
} catch (error) {
  emit({ ok: false, code: 'gateway_build_failed', message: String(error && error.stack) })
  process.exit(3)
}

const result = await startGateway(app, { handleSignals: false })
if (!result.ok) {
  emit({ ok: false, code: 'gateway_listen_failed', error: result.error, port })
  process.exit(1)
}

const address = app.server.address()
const bound = address && typeof address === 'object' ? String(address.address) : ''
if (!isLoopback(bound)) {
  emit({ ok: false, code: 'non_loopback_bind', bound })
  app.close()
  process.exit(4)
}

emit({
  ok: true,
  port: result.port,
  host: bound,
  pid: process.pid,
  routes: app.routes,
  addonEndpoint: 'ws://' + bound + ':' + String(result.port) + '/addon',
})

let closing = false

function waitFor(predicate, budgetMs, stepMs = 100) {
  const deadline = Date.now() + budgetMs
  return new Promise((resolve) => {
    const tick = () => {
      let done = false
      try {
        done = predicate()
      } catch {
        done = true
      }
      if (done || Date.now() >= deadline) resolve(done)
      else setTimeout(tick, stepMs)
    }
    tick()
  })
}

function closeServer(server, budgetMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    try {
      server.close(() => finish())
    } catch {
      finish()
      return
    }
    setTimeout(finish, budgetMs)
  })
}

/**
 * Bounded, explicit shutdown. Order matters:
 *   1. stop accepting new requests/jobs (close the HTTP server first);
 *   2. cancel the jobs this process owns, using each job's own owner identity —
 *      the queue's cancel() kills only the process tree that job spawned;
 *   3. wait (bounded) for those PIDs to disappear, then close the gateway.
 * Nothing here touches a Blender or a process this Gateway did not start.
 */
async function shutdown(reason) {
  if (closing) return
  closing = true
  const report = { event: 'shutdown', reason, canceled: [], stillAlive: [], closedOk: false }
  await closeServer(app.server, Math.min(2000, shutdownBudgetMs))
  try {
    const jobs = app.jobQueue.list()
    const terminal = new Set(['completed', 'failed', 'canceled'])
    for (const job of jobs) {
      if (terminal.has(String(job.state))) continue
      const pid = Number(job.pid) || 0
      const owner = job.owner || {}
      const caller = {
        hostId: String(owner.hostId || 'pi-desktop'),
        dshSessionId: String(owner.dshSessionId || 'pi-desktop-unknown'),
        agentId: String(owner.agentId || 'pi-desktop-main'),
        role: 'main',
      }
      try {
        const result = app.jobQueue.cancel(caller, job.id)
        report.canceled.push({ id: job.id, pid, canceled: result.canceled === true })
      } catch (error) {
        report.canceled.push({ id: job.id, pid, error: String(error && error.message) })
      }
    }
    const pids = report.canceled.map((item) => item.pid).filter((pid) => pid > 0)
    if (pids.length) {
      await waitFor(
        () =>
          pids.every((pid) => {
            try {
              process.kill(pid, 0)
              return false
            } catch {
              return true
            }
          }),
        shutdownBudgetMs,
      )
      report.stillAlive = pids.filter((pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      })
    }
    report.closedOk = true
  } catch (error) {
    report.error = String(error && error.message)
  }
  emit({ ok: report.stillAlive.length === 0, ...report })
  try {
    app.close()
  } catch {
    /* already closed */
  }
  setTimeout(() => process.exit(report.stillAlive.length === 0 ? 0 : 5), 50)
}

// Explicit IPC from the parent (the only writer on this pipe): not a signal,
// because Windows does not reliably run JS handlers for SIGTERM on a child.
let stdinBuffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuffer += String(chunk)
  for (;;) {
    const index = stdinBuffer.indexOf('\n')
    if (index < 0) break
    const line = stdinBuffer.slice(0, index).trim()
    stdinBuffer = stdinBuffer.slice(index + 1)
    if (!line) continue
    let message = null
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message && message.op === 'shutdown') void shutdown('ipc')
  }
})
process.stdin.on('end', () => void shutdown('stdin-end'))

// Signals are a fallback for a manual run; the parent uses the IPC path.
process.on('SIGTERM', () => void shutdown('sigterm'))
process.on('SIGINT', () => void shutdown('sigint'))
