#!/usr/bin/env node
/**
 * Build the Blender addon zip from the pinned source with Blender's own
 * extension builder (`blender --command extension build`), after applying the
 * one reviewable source delta in patches/addon-pairing-token.mjs.
 *
 * No third-party zipper, no prebuilt zip from upstream Releases.
 * The upstream baseline (vendor/UPSTREAM.lock.json) is never rewritten; the
 * delta and its hashes go to vendor/PATCHES.lock.json, and a human-readable
 * unified diff is written to patches/addon-pairing-token.diff.
 *
 * The diff must be shippable: git is invoked from the repo root with
 * repo-relative paths, so every `diff --git` / `---` / `+++` header carries a
 * stable `a/vendor/...` / `b/build/...` name. A header that is not a clean
 * `a/` or `b/` relative path (drive letter, absolute path, quoting) aborts the
 * build instead of shipping a host filesystem layout inside the package.
 *
 * Usage: node scripts/build-addon.mjs [--blender <path>] [--diff-only]
 *   --diff-only  stage + patch + rewrite the diff/lock only; no Blender, no
 *                addon/ overwrite (the shipped addon zip stays byte-identical).
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'vendor', 'source', 'extension', 'dsh_blender_bridge')
const STAGE_ROOT = path.join(ROOT, 'build', 'addon-src')
const STAGE = path.join(STAGE_ROOT, 'dsh_blender_bridge')
const STAGE_BASE = STAGE_ROOT
const OUT = path.join(ROOT, 'build', 'addon')
const COPY = path.join(ROOT, 'addon')
const MANIFEST = path.join(SRC, 'blender_manifest.toml')
const PATCH_LOCK = path.join(ROOT, 'vendor', 'PATCHES.lock.json')
const PATCH_DIFF = path.join(ROOT, 'patches', 'addon-pairing-token.diff')
const BUILD_DIR = path.join(ROOT, 'build')

const patch = await import('file:///' + path.join(ROOT, 'patches', 'addon-pairing-token.mjs').replace(/\\/g, '/'))

const diffOnly = process.argv.includes('--diff-only')

function arg(name) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : ''
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else out.push(path.relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

function repoRelative(target) {
  return path.relative(ROOT, target).replace(/\\/g, '/')
}

const blender = arg('blender') || process.env.DSH_BLENDER_EXE || ''
if (!diffOnly && !fs.existsSync(blender)) {
  console.error('build-addon: Blender not found: ' + blender + ' (pass --blender <path> or set DSH_BLENDER_EXE)')
  process.exit(1)
}
if (!fs.existsSync(MANIFEST)) {
  console.error('build-addon: missing vendored addon source: ' + MANIFEST)
  process.exit(1)
}

const manifestText = fs.readFileSync(MANIFEST, 'utf8')
const version = (manifestText.match(/^version\s*=\s*"([^"]+)"/m) || [])[1] || '0.0.0'
const id = (manifestText.match(/^id\s*=\s*"([^"]+)"/m) || [])[1] || 'unknown'

// 1. Stage a pristine copy of the upstream addon source.
fs.rmSync(STAGE_ROOT, { recursive: true, force: true })
fs.mkdirSync(STAGE_ROOT, { recursive: true })
fs.cpSync(SRC, STAGE, { recursive: true })

// 2. Apply the delta, refusing any anchor that is not unique.
const applied = []
for (const file of patch.FILES) {
  const target = path.join(STAGE_BASE, file.path)
  const before = fs.readFileSync(target, 'utf8')
  const result = patch.applyPatch(before, file.edits)
  const withNotice = patch.NOTICE_LINE + result.text
  fs.writeFileSync(target, withNotice)
  applied.push({
    file: file.path,
    upstreamSha256: sha256(before),
    patchedSha256: sha256(withNotice),
    edits: result.applied,
  })
  console.log('build-addon: patched ' + file.path + ' (' + String(result.applied.length) + ' edits)')
}

const HEADER_PATH = /^[ab]\/(?!\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/
//    the headers are `a/vendor/source/...` and `b/build/addon-src/...` and no
//    host absolute path can reach the package.
const STRICT_HEADER = /^(diff --git|---|\+\+\+) /
function writeDiff() {
  const diff = spawnSync(
    'git',
    [
      'diff',
      '--no-index',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      repoRelative(SRC),
      repoRelative(STAGE),
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 },
  )
  if (diff.error) {
    console.error('build-addon: git diff --no-index failed: ' + String(diff.error.message))
    process.exit(1)
  }
  const body = String(diff.stdout || '')
  const leaks = []
  for (const line of body.split('\n')) {
    if (!STRICT_HEADER.test(line)) continue
    const tokens = line.startsWith('diff --git ')
      ? line.slice('diff --git '.length).trim().split(/\s+/)
      : [line.slice(4).split('\t')[0].trim()]
    for (const token of tokens) {
      if (!HEADER_PATH.test(token)) leaks.push(token)
    }
  }
  if (leaks.length > 0) {
    console.error(
      'build-addon: diff headers are not stable repo-relative a/ b/ paths: ' +
        JSON.stringify(leaks.slice(0, 4)),
    )
    process.exit(1)
  }
  fs.writeFileSync(
    PATCH_DIFF,
    '# Delta against upstream dsh-blender-plugin @ ' + patch.UPSTREAM.commit + '\n' +
      '# Generated by scripts/build-addon.mjs; apply nothing by hand.\n' +
      body,
  )
}

// 4. Lock the delta separately from the upstream baseline.
function writeLock() {
  const lock = {
    patch: patch.PATCH_ID,
    version: patch.PATCH_VERSION,
    date: patch.PATCH_DATE,
    upstream: patch.UPSTREAM,
    note:
      'This file records ONLY the source delta applied at build time. vendor/UPSTREAM.lock.json ' +
      'still records the unmodified upstream tree and is never rewritten by the patch.',
    files: applied,
    stagedFileCount: walk(STAGE).length,
    diff: repoRelative(PATCH_DIFF),
  }
  fs.writeFileSync(PATCH_LOCK, JSON.stringify(lock, null, 2) + '\n')
}

if (diffOnly) {
  writeDiff()
  writeLock()
  console.log('build-addon: --diff-only delta lock ' + repoRelative(PATCH_LOCK) + ' · diff ' + repoRelative(PATCH_DIFF))
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  process.exit(0)
}

// 5. Blender builds the extension from the staged tree.
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const build = spawnSync(blender, ['--command', 'extension', 'build', '--source-dir', STAGE, '--output-dir', OUT], {
  encoding: 'utf8',
  timeout: 600000,
})
process.stdout.write(build.stdout || '')
process.stderr.write(build.stderr || '')
if (build.status !== 0) {
  console.error('build-addon: blender extension build failed with ' + String(build.status))
  process.exit(1)
}

const zip = path.join(OUT, id + '-' + version + '.zip')
if (!fs.existsSync(zip)) {
  console.error('build-addon: expected output missing: ' + zip)
  process.exit(1)
}

const validate = spawnSync(blender, ['--command', 'extension', 'validate', zip], { encoding: 'utf8', timeout: 300000 })
process.stdout.write(validate.stdout || '')
if (validate.status !== 0) {
  console.error('build-addon: blender extension validate failed')
  process.exit(1)
}

writeDiff()
writeLock()

const bytes = fs.readFileSync(zip)
const sha = sha256(bytes)
fs.mkdirSync(COPY, { recursive: true })
fs.copyFileSync(zip, path.join(COPY, path.basename(zip)))
fs.writeFileSync(path.join(COPY, 'SHA256SUMS'), sha + '  ' + path.basename(zip) + '\n')
console.log('build-addon: ' + zip + ' · ' + String(bytes.length) + 'B · sha256 ' + sha)
console.log('build-addon: delta lock ' + repoRelative(PATCH_LOCK) + ' · diff ' + repoRelative(PATCH_DIFF))

// build/ only holds staging; the shipped copy lives in addon/.
fs.rmSync(BUILD_DIR, { recursive: true, force: true })
