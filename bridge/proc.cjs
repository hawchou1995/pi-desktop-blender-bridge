'use strict'
/**
 * Supervises the vendored dsh-blender Gateway child process.
 *
 * PI-Desktop plugin entries run in an Electron utility process and the host has
 * no "spawn a process" API, so the plugin keeps the upstream topology (a
 * dedicated Gateway process, exactly `node lib/runtime/gateway.js`) and starts
 * it with Node itself. No download, no installer, no elevation: the runtime is
 * either PI-Desktop's own Node (ELECTRON_RUN_AS_NODE) or a Node on PATH that the
 * user already has.
 *
 * Failure handling is deliberate:
 *   - every start/stop/restart runs through one serial queue, so a second start
 *     can never overwrite the handle of a child that is still alive;
 *   - a start that times out or reports a failure is torn down (IPC shutdown →
 *     wait exit → kill), so no owned child or listening port is left behind;
 *   - shutdown is an explicit IPC line on the child's stdin (Windows does not
 *     reliably run JS handlers for SIGTERM), the child cancels the jobs it owns
 *     and reports the PIDs it cancelled, and only then does the parent escalate.
 */

const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { normalizePort } = require('./port.cjs')

const DEFAULT_READY_TIMEOUT_MS = 25000
const DEFAULT_SHUTDOWN_BUDGET_MS = Number(process.env.PI_BRIDGE_SHUTDOWN_BUDGET_MS) || 8000
const KILL_GRACE_MS = 3000
const MIN_NODE_MAJOR = 22

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function majorOf(version) {
  return Number(String(version || '').replace(/^v/, '').split('.')[0]) || 0
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Resolve true when the child exits within the budget. */
function waitExit(child, budgetMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      resolve(exited)
    }
    child.once('exit', () => finish(true))
    setTimeout(() => finish(child.exitCode !== null || child.signalCode !== null), budgetMs)
  })
}

/** Probe one candidate interpreter; returns its version string or null. */
function probe(candidate) {
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    let child
    try {
      child = spawn(candidate.cmd, [...candidate.args, '--version'], {
        env: candidate.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      finish(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish(null)
    }, 8000)
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += String(chunk)
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      const match = out.match(/v(\d+\.\d+\.\d+)/)
      finish(match ? match[1] : null)
    })
  })
}

class GatewaySupervisor {
  constructor(options) {
    this.pluginDir = options.pluginDir
    this.dataDir = options.dataDir
    this.settings = options.settings || {}
    // `entryPath` is a test/diagnostic override; production always uses the
    // adapter entry next to this file.
    this.entry = options.entryPath || path.join(this.pluginDir, 'bridge', 'gateway-entry.mjs')
    this.logDir = ensureDir(path.join(this.dataDir, 'logs'))
    this.logFile = path.join(this.logDir, 'gateway.log')
    this.child = null
    this.token = ''
    this.addonToken = String(options.addonToken || '')
    this.info = null
    this.lastError = null
    this.interpreter = null
    /** Serial queue: start/stop/restart never interleave. */
    this.ops = Promise.resolve()
    /** Last `{event:'shutdown',...}` report emitted by the child. */
    this.lastShutdown = null
    /** Append log stream for one child lifetime; always closed before a new start. */
    this.logStream = null
  }

  get port() {
    return normalizePort(this.settings.gatewayPort)
  }

  get shutdownBudgetMs() {
    const configured = Number(this.settings.shutdownBudgetMs)
    return Number.isInteger(configured) && configured >= 500 && configured <= 60000
      ? configured
      : DEFAULT_SHUTDOWN_BUDGET_MS
  }

  /** Readiness budget; settings/env are read at call time so tests and users can override. */
  get readyTimeoutMs() {
    const configured = Number(this.settings.readyTimeoutMs)
    if (Number.isInteger(configured) && configured >= 100 && configured <= 120000) return configured
    const fromEnv = Number(process.env.PI_BRIDGE_READY_TIMEOUT_MS)
    if (Number.isInteger(fromEnv) && fromEnv >= 100 && fromEnv <= 120000) return fromEnv
    return DEFAULT_READY_TIMEOUT_MS
  }

  get workDir() {
    const configured = String(this.settings.workDir || '').trim()
    return configured || path.join(this.dataDir, 'rt')
  }

  setAddonToken(token) {
    const next = String(token || '')
    if (next.length < 8) throw new Error('配对码至少 8 个字符')
    this.addonToken = next
  }

  /** Resolve a Node >= 22 interpreter: user setting, PI's own Node, then PATH. */
  async resolveInterpreter() {
    if (this.interpreter) return this.interpreter
    const candidates = []
    const configured = String(this.settings.nodePath || '').trim()
    if (configured) candidates.push({ cmd: configured, args: [], env: process.env })
    const runAsNode = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    if (process.versions && process.versions.electron && process.execPath) {
      candidates.push({ cmd: process.execPath, args: [], env: runAsNode })
    }
    candidates.push({ cmd: 'node', args: [], env: process.env })
    for (const candidate of candidates) {
      const version = await probe(candidate)
      if (version && majorOf(version) >= MIN_NODE_MAJOR) {
        this.interpreter = { ...candidate, version }
        return this.interpreter
      }
    }
    throw new Error(
      '找不到 Node >= ' +
        String(MIN_NODE_MAJOR) +
        ' 可执行文件。设置项 nodePath 指向 node.exe，或安装 Node 24 LTS（Gateway 与上游 engines 要求 Node >= 24.9；' +
        '本机实测 ' +
        (process.versions ? process.versions.node : '?') +
        '）。已尝试：' +
        candidates.map((c) => c.cmd).join(' / '),
    )
  }

  status() {
    return {
      running: !!this.child && this.info !== null,
      port: this.port,
      workDir: this.workDir,
      endpoint: this.info ? this.info.addonEndpoint : '',
      pid: this.info ? this.info.pid : this.child ? this.child.pid : null,
      routes: this.info ? this.info.routes : [],
      interpreter: this.interpreter ? this.interpreter.cmd + ' v' + this.interpreter.version : '',
      logFile: this.logFile,
      lastError: this.lastError,
      lastShutdown: this.lastShutdown,
      pairingRequired: true,
    }
  }

  /** Run fn after every previously queued operation settled. */
  _serialize(fn) {
    const run = this.ops.then(fn, fn)
    this.ops = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  start() {
    return this._serialize(() => this._start())
  }

  stop() {
    return this._serialize(() => this._stop())
  }

  restart() {
    return this._serialize(async () => {
      await this._stop()
      return this._start()
    })
  }

  _detach(child) {
    if (this.child === child) {
      this.child = null
      this.info = null
    }
  }

  /**
   * Tear down one child and wait for it to be gone: IPC shutdown, bounded wait,
   * then kill, then SIGKILL. Returns true only if the process is really gone.
   */
  async _disposeChild(child, reason) {
    if (!child) return true
    this._detach(child)
    if (child.exitCode !== null || child.signalCode !== null) return true
    try {
      if (child.stdin && child.stdin.writable) child.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n')
    } catch {
      /* pipe already closed */
    }
    let exited = await waitExit(child, this.shutdownBudgetMs)
    if (!exited) {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      exited = await waitExit(child, KILL_GRACE_MS)
    }
    if (!exited) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      exited = await waitExit(child, KILL_GRACE_MS)
    }
    if (reason) {
      this.lastError =
        reason + (exited ? '' : '；进程在 ' + String(this.shutdownBudgetMs + 2 * KILL_GRACE_MS) + 'ms 内未退出')
    }
    // The stream belongs to this child lifetime: close it before anyone can
    // start another child (no dangling fd, no write-after-end on restart).
    this._closeLog()
    return exited
  }

  /** Open the append log for one child lifetime (closes any previous one). */
  _openLog() {
    this._closeLog()
    const stream = fs.createWriteStream(this.logFile, { flags: 'a' })
    stream.on('error', () => {
      if (this.logStream === stream) this.logStream = null
    })
    this.logStream = stream
    return stream
  }

  /** End the append log once; safe to call repeatedly. */
  _closeLog() {
    const stream = this.logStream
    this.logStream = null
    if (!stream) return
    try {
      stream.end()
    } catch {
      /* already closed */
    }
  }

  /** Write only while this exact stream is still the live one and writable. */
  _logTo(stream, text) {
    if (!stream || this.logStream !== stream) return
    if (stream.writableEnded || !stream.writable) return
    try {
      stream.write(text)
    } catch {
      /* the pipe closed first; the exit handler closes the stream */
    }
  }

  async _start() {
    if (this.info) return this.info
    this.lastError = null
    if (!fs.existsSync(this.entry)) {
      throw new Error('缺少 Gateway 适配入口：' + this.entry + '（先 npm run build 生成 vendor/dsh-runtime）')
    }
    if (this.addonToken.length < 8) {
      throw new Error('缺少 addon 配对码（≥8 字符）；先在面板「生成/复制配对码」并填到 Blender addon 偏好里')
    }
    const interp = await this.resolveInterpreter()
    this.token = crypto.randomBytes(24).toString('hex')
    ensureDir(this.workDir)
    const env = {
      ...interp.env,
      DSH_BLENDER_WORKDIR: this.workDir,
      DSH_BLENDER_GATEWAY_PORT: String(this.port),
      DSH_BLENDER_HOLDER: 'pi-desktop',
    }
    const blenderExe = String(this.settings.blenderExe || '').trim()
    if (blenderExe) env.DSH_BLENDER_EXE = blenderExe

    const log = this._openLog()
    this._logTo(
      log,
      '\n=== ' +
        new Date().toISOString() +
        ' start port=' +
        String(this.port) +
        ' workDir=' +
        this.workDir +
        ' pairing=on\n',
    )
    const child = spawn(
      interp.cmd,
      [
        ...interp.args,
        this.entry,
        '--port',
        String(this.port),
        '--token',
        this.token,
        '--addon-token',
        this.addonToken,
        '--shutdown-ms',
        String(this.shutdownBudgetMs),
      ],
      {
        cwd: this.pluginDir,
        env,
        windowsHide: true,
        // stdin is the authenticated control pipe (only the parent holds it).
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    this.child = child
    child.stderr.on('data', (chunk) => this._logTo(log, String(chunk)))
    // The stream lives exactly as long as this child's stdio.
    child.once('close', () => {
      if (this.logStream === log) this._closeLog()
    })

    const info = await new Promise((resolve, reject) => {
      let buffered = ''
      let settled = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      const timer = setTimeout(
        () => settle(reject, new Error('Gateway 在 ' + String(this.readyTimeoutMs) + 'ms 内没有就绪；见日志 ' + this.logFile)),
        this.readyTimeoutMs,
      )
      child.stdout.on('data', (chunk) => {
        const text = String(chunk)
        this._logTo(log, text)
        if (settled) {
          // Late lines: keep the shutdown report for `status()`.
          for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('{')) continue
            try {
              const parsed = JSON.parse(trimmed)
              if (parsed && parsed.event === 'shutdown') this.lastShutdown = parsed
            } catch {
              /* not a structured line */
            }
          }
          return
        }
        buffered += text
        const line = buffered
          .split('\n')
          .find((item) => item.trim().startsWith('{'))
        if (!line) return
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch {
          return
        }
        if (parsed.ok !== true) settle(reject, new Error('Gateway 启动失败：' + JSON.stringify(parsed).slice(0, 800)))
        else settle(resolve, parsed)
      })
      child.on('error', (error) =>
        settle(reject, new Error('Gateway 进程启动失败：' + (error && error.message))),
      )
      child.on('exit', (code) => {
        this._detach(child)
        if (!settled) settle(reject, new Error('Gateway 进程提前退出（code=' + String(code) + '）；见日志 ' + this.logFile))
      })
    }).catch(async (error) => {
      // Bounded cleanup: never leave an owned child or a listening port behind.
      const gone = await this._disposeChild(child, String(error && error.message))
      const wrapped = new Error(
        String(error && error.message) + (gone ? '（已清理子进程）' : '（子进程未能退出，已记录 lastError）'),
      )
      this.lastError = wrapped.message
      throw wrapped
    })
    this.info = info
    return info
  }

  async _stop() {
    const child = this.child
    if (!child) {
      this.info = null
      return { canceled: false, stillAlive: [] }
    }
    const gone = await this._disposeChild(child, '')
    return {
      canceled: true,
      gone,
      report: this.lastShutdown,
      leftovers: this.lastShutdown && Array.isArray(this.lastShutdown.stillAlive)
        ? this.lastShutdown.stillAlive.filter((pid) => pidAlive(pid))
        : [],
    }
  }
}

module.exports = { GatewaySupervisor, ensureDir, MIN_NODE_MAJOR, pidAlive }
