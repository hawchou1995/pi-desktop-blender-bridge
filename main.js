'use strict'
/**
 * PI-Desktop entry for the Blender bridge.
 *
 * Host adaptation only. The six tools, the Gateway protocol (12), the addon
 * handshake, the lease/scope/txn layer, the headless job queue and the Python
 * kernel all come from the vendored dsh-blender-plugin 3.1.0-alpha.1 runtime
 * (BSD-3-Clause) and its Blender addon (GPL-3.0-or-later, rebuilt from source).
 *
 * Permissions requested: agent.tool.register, agent.prompt.inject, ui.panel.
 * There is no host API for a loopback listener or a child process, so the
 * plugin's own Node process (documented as not-an-OS-sandbox) starts the
 * Gateway child and talks to it on 127.0.0.1 with a per-run token.
 */

const path = require('node:path')
const { GatewaySupervisor } = require('./bridge/proc.cjs')
const { makeTools } = require('./bridge/tools.cjs')
const { GatewayClient } = require('./bridge/client.cjs')

const crypto = require('node:crypto')
const fs = require('node:fs')
const { normalizePort } = require('./bridge/port.cjs')

const PLUGIN_DIR = __dirname
const COMMAND_IDS = [
  'blender-bridge.status',
  'blender-bridge.open-panel',
  'blender-bridge.restart-gateway',
  'blender-bridge.addon-path',
  'blender-bridge.pairing-code',
  'blender-bridge.rotate-pairing',
]

let settings = {}
let dataDir = ''
let supervisor = null
let registeredTools = []
let starting = null
let pairing = null

function clientFor(caller) {
  return new GatewayClient({
    port: supervisor ? supervisor.port : normalizePort(settings.gatewayPort),
    token: supervisor ? supervisor.token : '',
    holder: 'pi-desktop',
    caller: caller || {},
  })
}

/**
 * Pairing secret for the addon channel. It lives in this plugin's private data
 * directory (never settings.json, never the log, never a tool result), is shown
 * only in the user-facing panel/命令, and is required by the Gateway before the
 * WebSocket upgrade. After one pairing the addon keeps it in its preferences, so
 * reconnects keep working without re-entering it.
 */
function loadOrCreatePairing() {
  const file = path.join(dataDir, 'pairing.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed.addonToken === 'string' && parsed.addonToken.length >= 8) {
      return { file, addonToken: parsed.addonToken, createdAt: parsed.createdAt || null }
    }
  } catch {
    /* first run */
  }
  const record = {
    version: 1,
    addonToken: crypto.randomBytes(18).toString('base64url'),
    createdAt: new Date().toISOString(),
    note: 'PI-Desktop Blender bridge pairing code. Paste it into the Blender add-on preference "Gateway Pairing Code". Rotate by deleting this file or running the rotate command.',
  }
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  return { file, addonToken: record.addonToken, createdAt: record.createdAt }
}

function rotatePairing() {
  const file = path.join(dataDir, 'pairing.json')
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* nothing to remove */
  }
  pairing = loadOrCreatePairing()
  if (supervisor) supervisor.setAddonToken(pairing.addonToken)
  return pairing
}

async function ensureStarted() {
  if (!supervisor) throw new Error('插件尚未加载完成')
  if (supervisor.info) return supervisor.info
  if (settings.autoStart === false) {
    throw new Error(
      'Gateway 未自动启动（autoStart=false）。运行命令「Blender Bridge: 重启 Gateway」启动，或把设置 autoStart 打开。',
    )
  }
  if (starting) return starting
  starting = supervisor
    .start()
    .catch((error) => {
      console.error('[pi-blender-bridge] gateway start failed: ' + String(error && error.message))
      throw error
    })
    .finally(() => {
      starting = null
    })
  return starting
}

function addonZipPath() {
  const file = path.join(PLUGIN_DIR, 'addon', 'dsh_blender_bridge-2.0.0.zip')
  return file
}

function summary(includePairing) {
  const status = supervisor ? supervisor.status() : { running: false }
  const pairingInfo = {
    file: pairing ? pairing.file : '',
    createdAt: pairing ? pairing.createdAt : null,
    required: true,
  }
  // The pairing code itself is only returned to the user-facing panel/command,
  // never to a model tool result.
  if (includePairing && pairing) pairingInfo.code = pairing.addonToken
  return {
    pluginId: 'io.github.hawchou1995.pi-desktop-blender-bridge',
    version: '3.1.4',
    upstream: {
      repo: 'sixtysevenlf/dsh-blender-plugin',
      commit: '6c5614712972a5cbca52b13d4df9193d76e76b0d',
      version: '3.1.0-alpha.1',
      addonProtocol: 12,
    },
    settings,
    dataDir,
    gateway: status,
    tools: registeredTools,
    addonZip: addonZipPath(),
    pairing: pairingInfo,
  }
}

async function gatewayHealth() {
  await ensureStarted()
  const client = clientFor({})
  const health = await client.get('/health', 8000)
  const status = await client.get('/status', 15000)
  let doctor = null
  let doctorError = ''
  try {
    doctor = await client.get('/doctor', 60000)
  } catch (error) {
    doctorError = String((error && error.message) || error)
  }
  return { ok: true, health, status, doctor, doctorError, gateway: supervisor.status() }
}

async function onLoad() {
  settings = (await pi.plugin.getSettings()) || {}
  dataDir = await pi.plugin.getDataPath()

  // Pairing: create or load the addon secret before the Gateway starts, so the
  // child can enforce it from the first dial.
  pairing = loadOrCreatePairing()
  supervisor = new GatewaySupervisor({
    pluginDir: PLUGIN_DIR,
    dataDir,
    settings,
    addonToken: pairing.addonToken,
  })

  // Register the six model tools; the executable descriptor must mirror
  // contributes.agentTools in manifest.json.
  const tools = makeTools({
    settings,
    dataDir,
    getToken: () => (supervisor ? supervisor.token : ''),
  })
  for (const tool of tools) {
    await pi.agent.registerTool({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      schema: tool.schema,
      execute: async (args, ctx) => {
        await ensureStarted()
        return tool.execute(args, ctx)
      },
    })
    registeredTools.push(tool.name)
  }

  await pi.commands.register({
    id: 'blender-bridge.status',
    title: 'Blender Bridge: 状态',
    run: async () => {
      const info = summary(false)
      await pi.ui.showToast(
        info.gateway.running
          ? 'Blender Bridge 运行中 · 127.0.0.1:' + String(info.gateway.port)
          : 'Blender Bridge 未启动 · 见面板/日志',
        info.gateway.running ? 'info' : 'warn',
      )
      return info
    },
  })
  await pi.commands.register({
    id: 'blender-bridge.open-panel',
    title: 'Blender Bridge: 打开诊断面板',
    run: async () => {
      await pi.ui.openPanel()
    },
  })
  await pi.commands.register({
    id: 'blender-bridge.restart-gateway',
    title: 'Blender Bridge: 重启 Gateway',
    run: async () => {
      await supervisor.restart()
      await pi.ui.showToast('Gateway 已重启 · 127.0.0.1:' + String(supervisor.port), 'info')
      return supervisor.status()
    },
  })
  await pi.commands.register({
    id: 'blender-bridge.addon-path',
    title: 'Blender Bridge: 复制 addon zip 路径',
    run: async () => {
      const file = addonZipPath()
      try {
        await pi.clipboard.writeText(file)
        await pi.ui.showToast('已复制 addon zip 路径：' + file, 'info')
      } catch {
        await pi.ui.showToast('addon zip：' + file, 'info')
      }
      return { file }
    },
  })

  await pi.commands.register({
    id: 'blender-bridge.pairing-code',
    title: 'Blender Bridge: 复制配对码',
    run: async () => {
      if (!pairing) pairing = loadOrCreatePairing()
      const code = pairing.addonToken
      try {
        await pi.clipboard.writeText(code)
        await pi.ui.showToast('配对码已复制：填到 Blender addon 偏好 Gateway Pairing Code', 'info')
      } catch {
        await pi.ui.openPanel()
      }
      return { ok: true, copied: true, note: '配对码只显示在本机 UI，不会进入日志或模型返回' }
    },
  })
  await pi.commands.register({
    id: 'blender-bridge.rotate-pairing',
    title: 'Blender Bridge: 轮换配对码',
    run: async () => {
      rotatePairing()
      if (supervisor) await supervisor.restart()
      try {
        await pi.clipboard.writeText(pairing.addonToken)
        await pi.ui.showToast('配对码已轮换并复制；请在 Blender addon 偏好里更新', 'warn')
      } catch {
        await pi.ui.showToast('配对码已轮换；在面板里查看新码', 'warn')
      }
      return { ok: true, rotated: true }
    },
  })

  if (settings.autoStart !== false) {
    try {
      await ensureStarted()
    } catch (error) {
      // Load must not fail: the tools report the same error with a fix hint.
      console.error('[pi-blender-bridge] autoStart: ' + String(error && error.message))
    }
  }
}

async function onUnload() {
  for (const name of registeredTools) {
    try {
      await pi.agent.unregisterTool(name)
    } catch {
      /* host is tearing down */
    }
  }
  registeredTools = []
  for (const id of COMMAND_IDS) {
    try {
      await pi.commands.unregister(id)
    } catch {
      /* host is tearing down */
    }
  }
  if (supervisor) {
    try {
      await supervisor.stop()
    } catch {
      /* nothing left to stop */
    }
  }
}

/** Panel diagnostics: status / doctor / restart / stop / log tail / addon zip. */
async function onPanelInvoke(channel, payload) {
  const name = String(channel || '')
  if (name === 'status') return summary(true)
  if (name === 'doctor') return gatewayHealth()
  if (name === 'start') {
    const info = await supervisor.start()
    return { ok: true, gateway: info }
  }
  if (name === 'stop') {
    await supervisor.stop()
    return { ok: true, gateway: supervisor.status() }
  }
  if (name === 'restart') {
    const info = await supervisor.restart()
    return { ok: true, gateway: info }
  }
  if (name === 'log') {
    const fs = require('node:fs')
    try {
      const text = fs.readFileSync(supervisor.logFile, 'utf8')
      const tail = Number(payload && payload.tail) || 8000
      return { ok: true, file: supervisor.logFile, text: text.slice(-tail) }
    } catch (error) {
      return { ok: false, file: supervisor.logFile, error: String((error && error.message) || error) }
    }
  }
  if (name === 'addon-path') return { ok: true, file: addonZipPath() }
  if (name === 'pairing') {
    if (!pairing) pairing = loadOrCreatePairing()
    // User-facing panel only; this channel is not reachable from a model tool.
    return { ok: true, code: pairing.addonToken, createdAt: pairing.createdAt, file: pairing.file }
  }
  if (name === 'rotate-pairing') {
    rotatePairing()
    if (supervisor) {
      try {
        await supervisor.restart()
      } catch (error) {
        return {
          ok: false,
          code: pairing.addonToken,
          error: String((error && error.message) || error),
        }
      }
    }
    return { ok: true, code: pairing.addonToken, createdAt: pairing.createdAt }
  }
  throw new Error('unknown panel channel: ' + name)
}

module.exports = { onLoad, onUnload, onPanelInvoke }
