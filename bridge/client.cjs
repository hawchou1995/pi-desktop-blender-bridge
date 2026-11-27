'use strict'
/**
 * Loopback HTTP client for the vendored dsh-blender Gateway.
 *
 * The upstream host talks to the Gateway over 127.0.0.1 with `x-dsh-*` caller
 * headers (runtime/http/caller.ts) plus the lease `holder`. This client keeps
 * that contract and adds the per-run `x-pi-bridge-token` that the adapter's
 * gateway-entry enforces, so no anonymous local caller reaches /act or /plan.
 */

const TOKEN_HEADER = 'x-pi-bridge-token'
const PLUGIN_HOST_ID = 'pi-desktop'

function base(port) {
  return 'http://127.0.0.1:' + String(port)
}

function callerHeaders(caller) {
  const headers = {
    'x-dsh-host-id': PLUGIN_HOST_ID,
    'x-dsh-session-id': String((caller && caller.sessionId) || 'pi-desktop-unknown'),
    'x-dsh-agent-id': String((caller && caller.agentId) || 'pi-desktop-main'),
    'x-dsh-agent-role': 'main',
  }
  if (caller && caller.turnId) headers['x-dsh-turn-id'] = String(caller.turnId)
  if (caller && caller.callId) headers['x-dsh-call-id'] = String(caller.callId)
  return headers
}

function timeoutError(path, ms) {
  const err = new Error('gateway request timed out after ' + String(ms) + 'ms: ' + path)
  err.code = 'gateway_timeout'
  return err
}

class GatewayClient {
  constructor(options) {
    this.port = Number(options.port)
    this.token = String(options.token || '')
    this.holder = String(options.holder || 'pi-desktop')
    this.caller = options.caller || {}
    // Aborting this signal aborts the LOCAL wait only. It cannot preempt code
    // already running inside Blender (bpy executes on Blender's own thread);
    // the Gateway keeps the job and the scene keeps changing.
    this.signal = options.signal || null
  }

  withCaller(caller) {
    return new GatewayClient({
      port: this.port,
      token: this.token,
      holder: this.holder,
      caller,
      signal: this.signal,
    })
  }

  headers(extra) {
    return {
      ...callerHeaders(this.caller),
      [TOKEN_HEADER]: this.token,
      ...(extra || {}),
    }
  }

  async request(method, path, body, timeoutMs) {
    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    // Merge the caller's signal (PI tool context) with the timeout so a
    // cancelled turn stops waiting immediately instead of burning the budget.
    const external = this.signal
    const merged =
      external && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([controller.signal, external])
        : controller.signal
    const init = { method, headers: this.headers(), signal: merged }
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    try {
      const res = await fetch(base(this.port) + path, init)
      const buffer = Buffer.from(await res.arrayBuffer())
      return { status: res.status, headers: res.headers, buffer }
    } catch (error) {
      if (external && external.aborted) {
        const aborted = new Error(
          '本地等待已取消（aborted）：只中止了 PI 侧的等待，Blender 内的 bpy 执行/作业不会被抢占',
        )
        aborted.code = 'aborted'
        throw aborted
      }
      if (controller.signal.aborted) throw timeoutError(path, ms)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Streaming routes (/headless /worker /txn /preset /job) answer NDJSON with
   * `{"heartbeat":true}` lines while the work runs; upstream keeps the last
   * non-heartbeat line (src/host/http.ts parseBackendBody). Same rule here.
   */
  static parseBody(text) {
    const raw = String(text == null ? '' : text)
    try {
      const whole = JSON.parse(raw)
      if (whole && typeof whole === 'object' && !Array.isArray(whole)) return whole
    } catch {
      /* streaming route */
    }
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    let last = null
    let heartbeats = 0
    for (const line of lines) {
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (!parsed || typeof parsed !== 'object') continue
      if (parsed.heartbeat === true) {
        heartbeats += 1
        continue
      }
      last = parsed
    }
    if (last) {
      last.__heartbeats = heartbeats
      last.__streamLines = lines.length
      return last
    }
    return { ok: false, raw: raw.slice(-500), parseError: 'no JSON line found' }
  }

  async json(method, path, body, timeoutMs) {
    const res = await this.request(method, path, body, timeoutMs)
    const text = res.buffer.toString('utf8')
    const parsed = GatewayClient.parseBody(text)
    parsed.__status = res.status
    return parsed
  }

  get(path, timeoutMs) {
    return this.json('GET', path, undefined, timeoutMs)
  }

  post(path, body, timeoutMs) {
    const payload = body && typeof body === 'object' ? { ...body, holder: this.holder } : body
    return this.json('POST', path, payload, timeoutMs)
  }

  /** POST /act with the lease holder, but without injecting holder into /view. */
  postRaw(path, body, timeoutMs) {
    return this.json('POST', path, body, timeoutMs)
  }

  async png(path, timeoutMs) {
    const res = await this.request('GET', path, undefined, timeoutMs)
    if (res.status !== 200) {
      throw new Error(
        'frame request failed: HTTP ' + String(res.status) + ' ' + res.buffer.toString('utf8').slice(0, 200),
      )
    }
    return res.buffer
  }

  async view(spec, timeoutMs) {
    const res = await this.request('POST', '/view', spec, timeoutMs || 180000)
    if (res.status !== 200) {
      throw new Error(
        'view failed: HTTP ' + String(res.status) + ' ' + res.buffer.toString('utf8').slice(0, 300),
      )
    }
    let meta = null
    try {
      const header = String(res.headers.get('x-dsh-view') || 'null')
      meta = JSON.parse(header.indexOf('%7B') === 0 ? decodeURIComponent(header) : header)
    } catch {
      meta = null
    }
    return { png: res.buffer, meta }
  }
}

module.exports = { GatewayClient, TOKEN_HEADER, PLUGIN_HOST_ID }
