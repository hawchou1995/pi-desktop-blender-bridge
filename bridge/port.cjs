'use strict'
/**
 * One port contract for every layer (supervisor, client, tools, panel).
 *
 * Upstream's own default is 39877 (runtime/catalog/../config.ts). A value that
 * is not an integer in 1..65535 is not "close enough": it would make the
 * supervisor listen on one thing while the tools talk to another, so every
 * caller resolves the port through this single function.
 */

const DEFAULT_GATEWAY_PORT = 39877

function normalizePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return DEFAULT_GATEWAY_PORT
  return port
}

module.exports = { DEFAULT_GATEWAY_PORT, normalizePort }
