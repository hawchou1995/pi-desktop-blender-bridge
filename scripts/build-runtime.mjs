#!/usr/bin/env node
/**
 * Deterministic runtime build for the vendored dsh-blender runtime.
 *
 * Input : vendor/source/runtime/**.ts   (upstream source, BSD-3-Clause, pinned commit)
 * Output: vendor/dsh-runtime/lib/runtime/**.js  (tsc, NodeNext ESM)
 *         vendor/dsh-runtime/runtime/**         (python assets + modules.json, copied verbatim)
 *
 * The layout matters: runtime/paths.ts resolves PY_ROOT as
 * `path.resolve(dirname(lib/runtime/x.js), '..', '..', 'runtime')`, i.e. the
 * package-relative `runtime/` next to `lib/` — the same layout upstream ships.
 *
 * No network access, no post-install hooks, no writes outside this project.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'vendor', 'source', 'runtime')
const OUT = path.join(ROOT, 'vendor', 'dsh-runtime')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

function fail(msg) {
  console.error('build-runtime: ' + msg)
  process.exit(1)
}

if (process.versions.node.split('.').map(Number)[0] < 24) {
  fail('Node >= 24.9 is required to build (runtime engines field), found ' + process.versions.node)
}
if (!fs.existsSync(SRC)) fail('missing vendored source: ' + SRC)
if (!fs.existsSync(TSC)) fail('missing typescript devDependency; run `npm ci` first')

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'lib', 'runtime'), { recursive: true })

const tsc = spawnSync(process.execPath, [TSC, '-p', path.join(ROOT, 'tsconfig.runtime.json')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
})
if (tsc.status !== 0) fail('tsc exited with ' + String(tsc.status))

// Python assets and JSON manifests the compiled runtime reads at run time.
const SKIP = new Set(['__pycache__'])
const SKIP_EXT = ['.ts', '.mts', '.cts', '.pyc', '.map']
let copied = 0
function walk(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      walk(path.join(from, entry.name), path.join(to, entry.name))
      continue
    }
    if (SKIP_EXT.some((ext) => entry.name.endsWith(ext))) continue
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name))
    copied += 1
  }
}
walk(SRC, path.join(OUT, 'runtime'))

// The compiled runtime is ESM; the plugin package itself is CommonJS, so the
// vendored subtree carries its own module type.
fs.writeFileSync(
  path.join(OUT, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-blender-runtime-vendored',
      private: true,
      version: '3.1.0-alpha.1',
      type: 'module',
      license: 'BSD-3-Clause',
    },
    null,
    2,
  ) + '\n',
)

const js = fs
  .readdirSync(path.join(OUT, 'lib', 'runtime'), { recursive: true })
  .filter((file) => String(file).endsWith('.js')).length
console.log('build-runtime: tsc OK · ' + String(js) + ' emitted .js · ' + String(copied) + ' python/asset files copied')
console.log('build-runtime: entry = ' + path.join(OUT, 'lib', 'runtime', 'gateway.js'))

// Single source of truth for the read-only session gate: the vendored catalog
// (runtime/catalog/data.ts → PLAN_READ_ONLY_OPS). Upstream keeps a host-side copy
// in src/tools/op/read-only.ts; the adapter generates it instead of copying it.
const catalog = await import('file:///' + path.join(OUT, 'lib', 'runtime', 'catalog', 'data.js').replace(/\\/g, '/'))
const readOnly = Array.isArray(catalog.PLAN_READ_ONLY_OPS) ? catalog.PLAN_READ_ONLY_OPS.map(String) : []
if (readOnly.length < 10) fail('catalog read-only list looks wrong: ' + String(readOnly.length))
const generated = path.join(ROOT, 'bridge', 'generated')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(
  path.join(generated, 'read-only-ops.json'),
  JSON.stringify({ source: 'vendor/source/runtime/catalog/data.ts · PLAN_READ_ONLY_OPS', count: readOnly.length, ops: readOnly }, null, 2) + '\n',
)
console.log('build-runtime: read-only ops = ' + String(readOnly.length) + ' → bridge/generated/read-only-ops.json')
