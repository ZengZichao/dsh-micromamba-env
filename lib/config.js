/**
 * Plugin configuration schema.
 *
 * The bundle is installed as a symlinked checkout, so a static
 * `import '@deepseek-ai/schemastery'` would resolve from the checkout's real
 * path and fail. Load it through an absolute path into the profile instead, and
 * fall back to a minimal Standard Schema when it is not installed.
 */

import { createRequire } from 'node:module'
import os from 'node:os'

export function homeDir() {
  return process.env.HOME || os.homedir()
}

export const CONFIG_DEFAULTS = {
  /** Absolute path to the micromamba executable. Empty = auto-detect (PATH, then common install dirs). */
  micromambaPath: '',
  /** micromamba root prefix (`-r`). Empty = MAMBA_ROOT_PREFIX, then micromamba's own default. */
  rootPrefix: '',
  /** Extra environment paths to show even when `micromamba env list` omits them. */
  extraEnvPaths: [],
  /** How many environments get a package summary on the list call (first N, base first). */
  maxDetailEnvs: 25,
  /** Hard cap on packages returned by one package-list call. */
  maxPackages: 20000,
  /** Per-command timeout for every micromamba invocation. */
  timeoutMs: 30000,
  /** Deny Python commands through Bash while a workspace has a selected environment. */
  enforcePythonTool: true,
  /** How long (ms) an environment listing may be reused before it is recomputed. */
  cacheTtlMs: 30000,
}

export function validateConfig(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const value = { ...CONFIG_DEFAULTS, extraEnvPaths: [] }
  const issues = []

  for (const key of ['micromambaPath', 'rootPrefix']) {
    const field = source[key]
    if (field === undefined || field === null) continue
    if (typeof field !== 'string') issues.push({ message: `${key} must be a string`, path: [key] })
    else value[key] = field
  }

  for (const [key, min, max] of [['maxDetailEnvs', 1, 200], ['maxPackages', 1, 50000], ['timeoutMs', 1000, 120000], ['cacheTtlMs', 0, 3600000]]) {
    const field = source[key]
    if (field === undefined || field === null) continue
    const number = Number(field)
    if (!Number.isInteger(number) || number < min || number > max) {
      issues.push({ message: `${key} must be an integer between ${min} and ${max}`, path: [key] })
    } else {
      value[key] = number
    }
  }

  if (source.enforcePythonTool !== undefined && source.enforcePythonTool !== null) {
    if (typeof source.enforcePythonTool !== 'boolean') {
      issues.push({ message: 'enforcePythonTool must be a boolean', path: ['enforcePythonTool'] })
    } else {
      value.enforcePythonTool = source.enforcePythonTool
    }
  }

  if (source.extraEnvPaths !== undefined && source.extraEnvPaths !== null) {
    if (!Array.isArray(source.extraEnvPaths) || source.extraEnvPaths.some((entry) => typeof entry !== 'string')) {
      issues.push({ message: 'extraEnvPaths must be an array of strings', path: ['extraEnvPaths'] })
    } else {
      value.extraEnvPaths = [...source.extraEnvPaths]
    }
  }

  return issues.length > 0 ? { issues } : { value }
}

export function loadSchemastery() {
  const require = createRequire(import.meta.url)
  const candidates = []
  if (process.env.DSH_PROFILE_DIR) {
    candidates.push(`${process.env.DSH_PROFILE_DIR}/node_modules/@deepseek-ai/schemastery`)
    candidates.push(`${process.env.DSH_PROFILE_DIR}/../node_modules/@deepseek-ai/schemastery`)
  }
  candidates.push(`${homeDir()}/.deepseek-harness/node_modules/@deepseek-ai/schemastery`)
  candidates.push('@deepseek-ai/schemastery')
  for (const candidate of candidates) {
    try {
      const mod = require(candidate)
      const z = mod && mod.default ? mod.default : mod
      if (z && typeof z.object === 'function') return z
    } catch { /* try the next candidate */ }
  }
  return null
}

const schemastery = loadSchemastery()

export const Config = schemastery
  ? schemastery.object({
      micromambaPath: schemastery.string().default(''),
      rootPrefix: schemastery.string().default(''),
      extraEnvPaths: schemastery.array(schemastery.string()).default([]),
      maxDetailEnvs: schemastery.number().step(1).min(1).max(200).default(25),
      maxPackages: schemastery.number().step(1).min(1).max(50000).default(20000),
      timeoutMs: schemastery.number().step(1).min(1000).max(120000).default(30000),
      enforcePythonTool: schemastery.boolean().default(true),
      cacheTtlMs: schemastery.number().step(1).min(0).max(3600000).default(30000),
    })
  : {
      '~standard': {
        version: 1,
        vendor: 'dsh-micromamba-env',
        validate: (value) => validateConfig(value),
      },
    }
