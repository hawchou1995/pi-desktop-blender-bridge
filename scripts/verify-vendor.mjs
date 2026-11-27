#!/usr/bin/env node
/**
 * Vendor lock: hash every file of the pinned upstream source plus the built
 * artifacts, so "the package matches the source" is reproducible by anyone.
 *
 *   node scripts/verify-vendor.mjs --write   # regenerate vendor/UPSTREAM.lock.json
 *   node scripts/verify-vendor.mjs           # verify source + build outputs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SOURCE = path.join(ROOT, 'vendor', 'source')
const RUNTIME_BUILD = path.join(ROOT, 'vendor', 'dsh-runtime')
const ADDON_DIR = path.join(ROOT, 'addon')
const LOCK = path.join(ROOT, 'vendor', 'UPSTREAM.lock.json')
const WRITE = process.argv.includes('--write')

const UPSTREAM = {
  repo: 'https://github.com/sixtysevenlf/dsh-blender-plugin',
  commit: '6c5614712972a5cbca52b13d4df9193d76e76b0d',
  version: '3.1.0-alpha.1',
  addonVersion: '2.0.0',
  addonProtocol: 12,
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walk(dir, base = dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, base, out)
      continue
    }
    out[path.relative(base, full).replace(/\\/g, '/')] = sha256(full)
  }
  return out
}

const sourceFiles = walk(SOURCE)
const runtimeFiles = walk(RUNTIME_BUILD)
// addon/ is a build artifact: it is locked by addon/SHA256SUMS and by
// vendor/PATCHES.lock.json (which records the delta hashes), not by this
// upstream baseline file.
const addonFiles = {}

const lock = {
  ...UPSTREAM,
  pinnedBy: 'PI Blender Bridge host adaptation (candidate, not published)',
  note:
    'vendor/source is the upstream tree at the pinned commit, unmodified, except ' +
    'vendor/source/package.json (module-type marker, see its own _note). ' +
    'vendor/dsh-runtime is the tsc build of vendor/source/runtime; ' +
    'addon/ is built from vendor/source/extension with Blender 5.3 extension build.',
  counts: {
    source: Object.keys(sourceFiles).length,
    runtimeBuild: Object.keys(runtimeFiles).length,
    addon: 'external: addon/SHA256SUMS + vendor/PATCHES.lock.json',
  },
  source: sourceFiles,
  runtimeBuild: runtimeFiles,
  addon: addonFiles,
}

if (WRITE) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true })
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n')
  console.log(
    'verify-vendor: wrote ' + LOCK + ' · source=' + String(lock.counts.source) +
      ' runtime=' + String(lock.counts.runtimeBuild) + ' addon=' + String(lock.counts.addon),
  )
  process.exit(0)
}

if (!fs.existsSync(LOCK)) {
  console.error('verify-vendor: missing ' + LOCK + ' (run with --write once)')
  process.exit(1)
}
const expected = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
const problems = []
for (const [name, actual, want] of [
  ['source', sourceFiles, expected.source],
  ['runtimeBuild', runtimeFiles, expected.runtimeBuild],
]) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(want || {})])
  for (const key of keys) {
    if (!(key in (want || {}))) problems.push(name + ': extra ' + key)
    else if (!(key in actual)) problems.push(name + ': missing ' + key)
    else if (actual[key] !== want[key]) problems.push(name + ': changed ' + key)
  }
}
if (expected.commit !== UPSTREAM.commit) problems.push('lock commit drifted: ' + expected.commit)
if (problems.length) {
  console.error('verify-vendor: ' + String(problems.length) + ' mismatch(es)')
  for (const line of problems.slice(0, 25)) console.error('  ' + line)
  process.exit(1)
}
console.log(
  'verify-vendor: OK · commit ' + expected.commit.slice(0, 12) + ' · source=' +
    String(Object.keys(sourceFiles).length) + ' runtime=' + String(Object.keys(runtimeFiles).length) +
    ' addon=' + String(Object.keys(addonFiles).length),
)
