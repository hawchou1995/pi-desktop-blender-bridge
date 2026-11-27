/**
 * Rebuildable source delta: addon pairing token for the /addon channel.
 *
 * Why this exists: the upstream addon dials the Gateway with no credential, so
 * any local process could impersonate an instance. The adapter requires a shared
 * secret; the addon therefore has to send one. This module is the *entire* delta
 * — scripts/build-addon.mjs copies vendor/source/extension into a staging tree,
 * applies these exact string edits (each must match exactly once), builds the
 * zip, and records the resulting hashes in vendor/PATCHES.lock.json.
 *
 * License: the addon is GPL-3.0-or-later. Every modified file gets a "Modified
 * by" line, and NOTICE documents the change and the date (GPL-3 §5a).
 */

export const PATCH_ID = 'addon-pairing-token'
export const PATCH_VERSION = '3.1.2'
export const PATCH_DATE = '2026-11-27'
export const NOTICE_LINE =
  '# Modified by PI Blender Bridge ' +
  PATCH_VERSION +
  ' (' +
  PATCH_DATE +
  '): addon pairing token (x-dsh-bridge-token) for the Gateway /addon channel.\n'

export const UPSTREAM = {
  repo: 'https://github.com/sixtysevenlf/dsh-blender-plugin',
  commit: '6c5614712972a5cbca52b13d4df9193d76e76b0d',
  addonVersion: '2.0.0',
  protocol: 12,
}

/** edits[].find must occur exactly once in the staged file. */
export const FILES = [
  {
    path: 'dsh_blender_bridge/transport.py',
    edits: [
      {
        note: 'carry caller-supplied upgrade headers',
        find: [
          '    def __init__(self, host: str, port: int, path: str = DEFAULT_WS_PATH,',
          '                 max_message_size: int = MAX_MESSAGE_SIZE):',
          '        self.host = host',
        ].join('\n'),
        replace: [
          '    def __init__(self, host: str, port: int, path: str = DEFAULT_WS_PATH,',
          '                 max_message_size: int = MAX_MESSAGE_SIZE,',
          '                 extra_headers=None):',
          '        self.host = host',
        ].join('\n'),
      },
      {
        note: 'store the headers, rejecting CR/LF injection',
        find: [
          '        self.max_message_size = int(max_message_size)',
          '        self._sock = None',
        ].join('\n'),
        replace: [
          '        self.max_message_size = int(max_message_size)',
          '        self.extra_headers = {}',
          '        for header_name, header_value in dict(extra_headers or {}).items():',
          '            name = str(header_name)',
          '            value = str(header_value)',
          '            if not name or "\\r" in name or "\\n" in name or "\\r" in value or "\\n" in value:',
          '                raise ValueError("invalid WebSocket upgrade header")',
          '            self.extra_headers[name] = value',
          '        self._sock = None',
        ].join('\n'),
      },
      {
        note: 'send the extra headers before the terminating blank line',
        find: [
          '                "Sec-WebSocket-Version: %d\\r\\n"',
          '                "\\r\\n"',
          '            ) % (self.path, self.host, self.port, key, WEBSOCKET_VERSION)',
          '            sock.sendall(request.encode("ascii"))',
        ].join('\n'),
        replace: [
          '                "Sec-WebSocket-Version: %d\\r\\n"',
          '            ) % (self.path, self.host, self.port, key, WEBSOCKET_VERSION)',
          '            for header_name, header_value in self.extra_headers.items():',
          '                request += "%s: %s\\r\\n" % (header_name, header_value)',
          '            request += "\\r\\n"',
          '            sock.sendall(request.encode("ascii"))',
        ].join('\n'),
      },
    ],
  },
  {
    path: 'dsh_blender_bridge/config.py',
    edits: [
      {
        note: 'resolve the pairing secret (env -> preference -> empty)',
        find: ['GATEWAY_HOST = "127.0.0.1"', 'GATEWAY_PATH = ADDON_WS_PATH'].join('\n'),
        replace: [
          'GATEWAY_HOST = "127.0.0.1"',
          'GATEWAY_PATH = ADDON_WS_PATH',
          'GATEWAY_TOKEN_HEADER = "X-DSH-Bridge-Token"',
          'GATEWAY_TOKEN_ENV = "DSHBB_GATEWAY_TOKEN"',
          '',
          '',
          'def get_gateway_token():',
          '    """Pairing secret for the Gateway /addon channel.',
          '',
          '    Resolution order: env DSHBB_GATEWAY_TOKEN -> add-on preference',
          '    gateway_token -> empty (no header, the Gateway refuses the upgrade).',
          '    """',
          '    raw = read_env_var(GATEWAY_TOKEN_ENV)',
          '    if raw:',
          '        return raw.strip()',
          '    preferences = get_dshbb_addon_preferences()',
          '    return str(getattr(preferences, "gateway_token", "") or "").strip()',
        ].join('\n'),
      },
    ],
  },
  {
    path: 'dsh_blender_bridge/server.py',
    edits: [
      {
        note: 'import the pairing helpers next to the port helpers',
        find: ['    get_gateway_host,', '    get_gateway_port,', '    gateway_url,'].join('\n'),
        replace: [
          '    get_gateway_host,',
          '    get_gateway_port,',
          '    get_gateway_token,',
          '    GATEWAY_TOKEN_HEADER,',
          '    gateway_url,',
        ].join('\n'),
      },
      {
        note: 'send the pairing header on every dial (reconnects included)',
        find: [
          '                connection = transport.WebSocketClient(',
          '                    self.gateway_host, self.gateway_port, path=GATEWAY_PATH)',
          '                connection.connect(timeout=HANDSHAKE_TIMEOUT_SECONDS)',
        ].join('\n'),
        replace: [
          '                token = get_gateway_token()',
          '                extra_headers = {GATEWAY_TOKEN_HEADER: token} if token else {}',
          '                connection = transport.WebSocketClient(',
          '                    self.gateway_host, self.gateway_port, path=GATEWAY_PATH,',
          '                    extra_headers=extra_headers)',
          '                connection.connect(timeout=HANDSHAKE_TIMEOUT_SECONDS)',
        ].join('\n'),
      },
    ],
  },
  {
    path: 'dsh_blender_bridge/ui/preferences.py',
    edits: [
      {
        note: 'persisted pairing code field',
        find: [
          '    hyper3d_api_key: bpy.props.StringProperty(',
          '        name="Hyper3D API Key",',
        ].join('\n'),
        replace: [
          '    gateway_token: bpy.props.StringProperty(',
          '        name="Gateway Pairing Code",',
          '        subtype="PASSWORD",',
          '        description="Pairing code copied from the PI-Desktop Blender Bridge panel or the "',
          '                    "command 复制配对码 (DSHBB_GATEWAY_TOKEN overrides this)",',
          '        default=""',
          '    )',
          '    hyper3d_api_key: bpy.props.StringProperty(',
          '        name="Hyper3D API Key",',
        ].join('\n'),
      },
      {
        note: 'show the field in the connection box',
        find: '        connection_box.prop(self, "gateway_port", text="Gateway Port")',
        replace: [
          '        connection_box.prop(self, "gateway_port", text="Gateway Port")',
          '        connection_box.prop(self, "gateway_token", text="Pairing Code")',
        ].join('\n'),
      },
    ],
  },
]

export function applyPatch(text, edits) {
  let out = text
  const applied = []
  for (const edit of edits) {
    const occurrences = out.split(edit.find).length - 1
    if (occurrences !== 1) {
      throw new Error(
        'patch anchor matched ' + String(occurrences) + ' times (expected 1) for "' +
          String(edit.note || edit.find.split('\n')[0]) + '"',
      )
    }
    out = out.replace(edit.find, edit.replace)
    applied.push(edit.note || '')
  }
  return { text: out, applied }
}
