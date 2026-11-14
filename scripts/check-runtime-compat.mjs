/**
 * Check this plugin against the DeepSeek Harness build installed on this machine.
 *
 * The desktop app ships its Host runtime inside `app.asar`, so the version it
 * actually boots is read straight out of the archive header instead of from a
 * profile's (possibly stale) `node_modules`. The script then validates the
 * manifest contract the current runtime parses and compares the detected
 * version with the range this plugin declares.
 *
 * Usage: npm run check:runtime [-- /path/to/DeepSeek Harness.app]
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const DEFAULT_APP = '/Applications/DeepSeek Harness.app'
const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function note(message) {
  notes.push(message)
}

/** Read a file out of an Electron `.asar` archive without external tools. */
function readAsar(archive, entry) {
  const fd = readFileSync(archive)
  const headerSize = fd.readUInt32LE(4)
  const dataStart = 8 + headerSize
  const header = fd.subarray(12, 12 + headerSize)
  const start = header.indexOf('{"files"')
  if (start < 0) throw new Error('asar: header does not start with a files map')
  const parsed = parseDecoder(header.subarray(start).toString('utf8'))
  const node = entry.replace(/^\//, '').split('/').reduce((current, part) => {
    if (!current || !current.files || !current.files[part]) throw new Error(`asar: no entry ${entry}`)
    return current.files[part]
  }, parsed)
  if (typeof node.offset !== 'string') throw new Error(`asar: ${entry} is a directory`)
  const offset = Number(node.offset)
  const size = node.size ?? 0
  return fd.subarray(dataStart + offset, dataStart + offset + size)
}

/** `JSON.parse` that tolerates the trailing bytes of the pickled header. */
function parseDecoder(text) {
  const end = text.lastIndexOf('}')
  return JSON.parse(text.slice(0, end + 1))
}

/** The runtime version the desktop app boots, when it can be located. */
function detectRuntimeVersion(appPath) {
  const archive = path.join(appPath, 'Contents', 'Resources', 'app.asar')
  if (!existsSync(archive)) return undefined
  try {
    const manifest = JSON.parse(readAsar(archive, '/dsh/package.json').toString('utf8'))
    return { version: manifest.version, source: archive }
  } catch (error) {
    note(`could not read the runtime manifest from ${archive}: ${error.message}`)
    return undefined
  }
}

/** Compare two dotted versions, ignoring prerelease suffixes. */
function compareVersions(left, right) {
  const parts = (value) => String(value).split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}

// ── manifest contract ────────────────────────────────────────────────────────

const client = pkg.dsh && pkg.dsh.client
if (!client || typeof client !== 'object') fail('package.json is missing dsh.client')
else {
  if (typeof client.platform !== 'string') fail('dsh.client.platform must be a string')
  if (client.platform !== 'web') fail(`dsh.client.platform must be "web", found ${JSON.stringify(client.platform)}`)
  for (const key of ['inject', 'external']) {
    const value = client[key]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      fail(`dsh.client.${key} must be an array of strings`)
    }
  }
  if (client.immediately !== undefined && typeof client.immediately !== 'boolean') {
    fail('dsh.client.immediately must be a boolean')
  }
}

const bundle = pkg.dsh && pkg.dsh.bundle
if (!bundle || typeof bundle.patch !== 'string') fail('package.json is missing dsh.bundle.patch')
else if (!existsSync(path.join(root, bundle.patch))) fail(`dsh.bundle.patch points at a missing file: ${bundle.patch}`)

if (!pkg.exports || pkg.exports['./client'] !== './client.js') fail('exports["./client"] must resolve to ./client.js')
if (!existsSync(path.join(root, 'client.js'))) fail('client.js is missing')

// ── bundle patch ─────────────────────────────────────────────────────────────

if (bundle && typeof bundle.patch === 'string') {
  const patchPath = path.join(root, bundle.patch)
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, 'utf8')
    if (!/^\s*-\s*insert:/m.test(text)) fail(`${bundle.patch} has no top-level "insert" row`)
    const rows = [...text.matchAll(/^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1].trim())
    if (!rows.includes(pkg.name)) fail(`${bundle.patch} does not insert the package itself (${pkg.name})`)
    else note(`${bundle.patch} inserts ${pkg.name}`)
  }
}

// ── runtime version ──────────────────────────────────────────────────────────

const appPath = process.argv[2] || DEFAULT_APP
const detected = detectRuntimeVersion(appPath)
const supported = pkg.dsh && pkg.dsh.harness
if (detected) {
  note(`installed runtime: ${detected.version} (${detected.source})`)
  if (supported) {
    const range = String(supported).replace(/^\^/, '')
    if (compareVersions(detected.version, range) < 0) {
      fail(`installed runtime ${detected.version} is older than the declared floor ${supported}`)
    } else {
      note(`installed runtime satisfies the declared floor ${supported}`)
    }
  } else {
    note('package.json declares no dsh.harness range; compatibility is asserted only by tests')
  }
} else if (!existsSync(appPath)) {
  note(`no DeepSeek Harness app at ${appPath}; skipping the runtime version check`)
} else {
  note('runtime version could not be read; skipping the version comparison')
}

// ── profile wiring ───────────────────────────────────────────────────────────

const profileDirs = (process.env.DSH_PROFILE_DIR ? [process.env.DSH_PROFILE_DIR] : [
  path.join(process.env.HOME || '', '.dsh', 'profiles', 'desktop'),
]).filter((directory) => existsSync(directory))
for (const profile of profileDirs) {
  const link = path.join(profile, 'node_modules', pkg.name)
  if (!existsSync(link)) {
    note(`${pkg.name} is not installed in ${profile} (expected for a plain checkout)`)
    continue
  }
  let target
  try {
    target = execFileSync('readlink', [link], { encoding: 'utf8' }).trim()
  } catch {
    note(`${pkg.name} is installed in ${profile} (copied, not linked)`)
    continue
  }
  if (target !== root) note(`${pkg.name} in ${profile} links to ${target}, not to this checkout (${root})`)
  else note(`${pkg.name} in ${profile} links to this checkout`)
}

// ── report ───────────────────────────────────────────────────────────────────

for (const line of notes) console.log(`info  ${line}`)
for (const line of failures) console.error(`FAIL  ${line}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} compatibility problem(s) found`)
  process.exitCode = 1
} else {
  console.log('\nmanifest and runtime checks passed')
}
