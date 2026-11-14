/**
 * micromamba reads: executable discovery plus the `env list` / `info` / `list`
 * JSON queries. Nothing here mutates an environment.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { homeDir } from './config.js'

const execFileAsync = promisify(execFile)

/** Resolve a path that may start with `~` and normalize it for comparisons. */
export function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  let text = value
  if (text === '~') text = homeDir()
  else if (text.startsWith('~/')) text = path.join(homeDir(), text.slice(2))
  try { return path.resolve(text) } catch { return text }
}

/** Pick the micromamba executable: configured value, then PATH, then common dirs. */
export function resolveMicromamba(configured) {
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  const fromEnv = process.env.MICROMAMBA || process.env.MAMBA_EXE
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  const candidates = [
    path.join(homeDir(), 'bin', 'micromamba'),
    path.join(homeDir(), '.local', 'bin', 'micromamba'),
    '/opt/homebrew/bin/micromamba',
    '/usr/local/bin/micromamba',
  ]
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return candidate } catch { /* keep looking */ }
  }
  return 'micromamba'
}

/** Resolve the root prefix: configured value, then MAMBA_ROOT_PREFIX, then micromamba's default. */
export function resolveRootPrefix(configured) {
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  const fromEnv = process.env.MAMBA_ROOT_PREFIX
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return ''
}

/** Run micromamba and capture JSON-friendly output; never throws. */
async function runMicromamba(binary, rootPrefix, args, timeoutMs) {
  const prefixArgs = rootPrefix ? ['-r', rootPrefix] : []
  try {
    const { stdout } = await execFileAsync(binary, [...prefixArgs, ...args], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
      windowsHide: true,
    })
    return { ok: true, stdout }
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : ''
    const stdout = typeof error.stdout === 'string' ? error.stdout : ''
    const message = stderr.trim() || error.message || String(error)
    return { ok: false, error: message, stdout, code: error.code }
  }
}

function parseJson(stdout) {
  try { return { ok: true, value: JSON.parse(stdout) } }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** micromamba version, root prefix, platform, and the active environment path. */
export async function micromambaInfo(binary, rootPrefix, timeoutMs) {
  const versionRes = await runMicromamba(binary, rootPrefix, ['--version'], timeoutMs)
  const infoRes = await runMicromamba(binary, rootPrefix, ['info', '--json'], timeoutMs)
  let data = null
  if (infoRes.ok) {
    const parsed = parseJson(infoRes.stdout)
    if (parsed.ok && parsed.value && typeof parsed.value === 'object') data = parsed.value
  }
  const baseEnvironment = data && typeof data['base environment'] === 'string' ? data['base environment'] : ''
  return {
    binary,
    version: versionRes.ok ? versionRes.stdout.trim() : '',
    rootPrefix: rootPrefix || baseEnvironment,
    platform: data && typeof data.platform === 'string' ? data.platform : '',
    activePath: data && typeof data['env location'] === 'string' ? data['env location'] : '',
    envsDirs: data && Array.isArray(data['envs directories']) ? data['envs directories'].filter((p) => typeof p === 'string') : [],
    error: versionRes.ok
      ? (data ? '' : (infoRes.error || 'micromamba info failed'))
      : (versionRes.error || 'micromamba is not available'),
  }
}

/** Display name for an environment path: `base` for the root prefix, else the basename. */
export function envName(envPath, root) {
  const normalized = normalizePath(envPath)
  if (root && normalized === root) return 'base'
  const base = path.basename(normalized)
  return base || normalized
}

/** Package summary for one environment (count + interpreter versions). */
async function envSummary(binary, rootPrefix, envPath, timeoutMs) {
  const res = await runMicromamba(binary, rootPrefix, ['list', '-p', envPath, '--json'], timeoutMs)
  if (!res.ok) return { path: envPath, packages: null, python: '', r: '', error: res.error }
  const parsed = parseJson(res.stdout)
  const packages = parsed.ok && Array.isArray(parsed.value) ? parsed.value : []
  const python = packages.find((p) => p && p.name === 'python')
  const r = packages.find((p) => p && (p.name === 'r-base' || p.name === 'r'))
  return {
    path: envPath,
    packages: packages.length,
    python: python && python.version ? String(python.version) : '',
    r: r && r.version ? String(r.version) : '',
    error: parsed.ok ? '' : parsed.error,
  }
}

/**
 * List environments with a bounded package summary for the first `maxDetailEnvs`.
 * Throws only when `micromamba env list` itself fails.
 */
export async function listEnvs(binary, rootPrefix, timeoutMs, extraEnvPaths, maxDetailEnvs) {
  const info = await micromambaInfo(binary, rootPrefix, timeoutMs)
  const res = await runMicromamba(binary, rootPrefix, ['env', 'list', '--json'], timeoutMs)
  if (!res.ok) throw new Error(res.error || 'micromamba env list failed')

  const parsed = parseJson(res.stdout)
  if (!parsed.ok) throw new Error(`could not parse micromamba env list output: ${parsed.error}`)
  const listed = parsed.value && Array.isArray(parsed.value.envs)
    ? parsed.value.envs.filter((p) => typeof p === 'string' && p.length > 0)
    : []

  const paths = [...listed]
  const seen = new Set(paths.map(normalizePath))
  for (const extra of Array.isArray(extraEnvPaths) ? extraEnvPaths : []) {
    if (typeof extra !== 'string' || !extra.trim()) continue
    const normalized = normalizePath(extra)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      paths.push(extra)
    }
  }

  const root = normalizePath(rootPrefix || info.rootPrefix || '')
  const active = normalizePath(info.activePath || '')
  const envs = paths.map((envPath) => {
    const normalized = normalizePath(envPath)
    return {
      name: envName(envPath, root),
      path: envPath,
      isBase: root !== '' && normalized === root,
      external: root !== '' && normalized !== root && !normalized.startsWith(root + path.sep),
      active: active !== '' && normalized === active,
      packages: null,
      python: '',
      r: '',
      error: '',
    }
  })

  const limit = Math.max(1, Math.min(Number(maxDetailEnvs) || 25, envs.length))
  const summaries = await Promise.all(envs.slice(0, limit).map((env) => envSummary(binary, rootPrefix, env.path, timeoutMs)))
  for (let index = 0; index < summaries.length; index++) {
    envs[index] = { ...envs[index], ...summaries[index] }
  }
  return { info, envs }
}

/** Full package list for one environment, optionally filtered by name/version. */
export async function listPackages(binary, rootPrefix, envPath, search, timeoutMs, maxPackages) {
  const res = await runMicromamba(binary, rootPrefix, ['list', '-p', envPath, '--json'], timeoutMs)
  if (!res.ok) throw new Error(res.error || 'micromamba list failed')
  const parsed = parseJson(res.stdout)
  if (!parsed.ok) throw new Error(`could not parse micromamba list output: ${parsed.error}`)
  const raw = Array.isArray(parsed.value) ? parsed.value : []

  const query = typeof search === 'string' ? search.trim().toLowerCase() : ''
  let rows = raw
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({
      name: p.name,
      version: typeof p.version === 'string' ? p.version : '',
      build: typeof p.build_string === 'string' ? p.build_string : '',
      channel: typeof p.channel === 'string' ? p.channel : '',
      platform: typeof p.platform === 'string' ? p.platform : '',
    }))
  if (query) {
    rows = rows.filter((row) => row.name.toLowerCase().includes(query) || row.version.toLowerCase().includes(query))
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  const total = rows.length
  const limit = Math.max(1, Number(maxPackages) || 20000)
  return { path: envPath, total, truncated: total > limit, packages: rows.slice(0, limit) }
}

/** Resolve a user-supplied environment name or path to a real environment path. */
export async function resolveEnvPath(env, binary, rootPrefix, timeoutMs, extraEnvPaths) {
  const wanted = typeof env === 'string' ? env.trim() : ''
  if (!wanted) return ''
  const { envs } = await listEnvs(binary, rootPrefix, timeoutMs, extraEnvPaths, 1)
  const normalized = normalizePath(wanted)
  const exact = envs.find((entry) => normalizePath(entry.path) === normalized)
  if (exact) return exact.path
  const byName = envs.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase())
  if (byName) return byName.path
  return wanted
}

/** Environment rows for the picker: `{ name, path, source }`. */
export async function micromambaEnvironments(binary, rootPrefix, timeoutMs, extraEnvPaths) {
  const { envs } = await listEnvs(binary, rootPrefix, timeoutMs, extraEnvPaths, 1)
  return envs.map((env) => ({ name: env.name, path: env.path, source: 'micromamba' }))
}
