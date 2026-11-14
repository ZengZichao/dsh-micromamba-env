/**
 * Per-workspace environment selection, sandbox-aware execution, and the
 * execution-policy guard.
 *
 * The selection is stored in `<workspace>/.context/micromamba-environment.json`,
 * modeled on dsh-conda-workspace-env-main.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizePath } from './micromamba.js'

const execFileAsync = promisify(execFile)

export const SELECTION_DIR = '.context'
export const SELECTION_FILE = 'micromamba-environment.json'

/** Read one workspace's selection; a missing file means "nothing selected". */
export async function readSelection(root) {
  const fallback = { workspace: root, environment: null }
  try {
    const parsed = JSON.parse(await readFile(path.join(root, SELECTION_DIR, SELECTION_FILE), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return fallback
    // A selection written for a different directory (moved/copied workspace) is
    // not this workspace's choice.
    if (typeof parsed.workspace === 'string' && parsed.workspace && normalizePath(parsed.workspace) !== normalizePath(root)) {
      return fallback
    }
    return parsed
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    throw error
  }
}

/** Persist one workspace's selection (`environment` null clears it). */
export async function saveSelection(root, environment) {
  await mkdir(path.join(root, SELECTION_DIR), { recursive: true })
  const value = { workspace: root, environment, updatedAt: new Date().toISOString() }
  await writeFile(path.join(root, SELECTION_DIR, SELECTION_FILE), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return value
}

/** The selected environment for a workspace, with its interpreter paths. */
export async function selectedEnvironment(root) {
  const selection = await readSelection(root)
  const environment = selection.environment
  if (!environment || typeof environment.path !== 'string' || !environment.path) return null
  return {
    ...environment,
    python: environmentPython(environment.path),
    rscript: environmentRscript(environment.path),
  }
}

function environmentPython(prefix) {
  return path.join(prefix, process.platform === 'win32' ? 'python.exe' : 'bin/python')
}

function environmentRscript(prefix) {
  return path.join(prefix, process.platform === 'win32' ? 'Scripts\\Rscript.exe' : 'bin/Rscript')
}

function environmentPath(prefix) {
  const entries = process.platform === 'win32'
    ? [prefix, path.join(prefix, 'Scripts'), path.join(prefix, 'Library', 'bin')]
    : [path.join(prefix, 'bin')]
  return `${entries.join(path.delimiter)}${path.delimiter}${process.env.PATH || ''}`
}

/** Map a requested command onto the selected environment's interpreter. */
export function resolveEnvironmentCommand(environment, command) {
  const name = String(command || '').replace(/^.*[\\/]/, '')
  if (/^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(name)) return environment.python
  if (/^Rscript(?:\.exe)?$/i.test(name)) return environment.rscript
  return command
}

/** Shell-quote one argv element for a `sh -c` command line. */
export function shellQuote(value) {
  const text = String(value)
  if (text === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * Run a command line with the workspace's selected environment on PATH.
 *
 * When a sandboxing shell executor (`ctx.shell`) is mounted, the command runs
 * through it with the resolved sandbox policy, so `micromamba_run` is confined
 * exactly like the Bash tool. Without one, it falls back to executing the parsed
 * argv directly (no shell operators).
 *
 * The executor seam has two faces on current Harness builds: the declared
 * `run(spec) => ShellRunResult` contract, and the concrete executors'
 * `execute(spec) => handle` whose `result()` settles the same shape. Either is
 * accepted, so the plugin follows whichever build it is loaded into.
 */
export async function runInWorkspaceEnvironment(root, command, options = {}) {
  const environment = options.environment || await selectedEnvironment(root)
  if (!environment) throw new Error('No micromamba environment is selected for this workspace')
  const env = {
    ...process.env,
    ...(options.env || {}),
    CONDA_PREFIX: environment.path,
    CONDA_DEFAULT_ENV: environment.name || path.basename(environment.path),
    PYTHONNOUSERSITE: '1',
    PATH: environmentPath(environment.path),
  }
  const workdir = options.cwd || root
  const timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeout) || 30000))
  const shell = options.shell
  if (shell && typeof shell.resolve === 'function') {
    const request = {
      command: command.commandLine,
      workdir,
      timeoutMs,
      env,
      stdoutMaxBytes: 2 * 1024 * 1024,
    }
    if (options.sandboxPolicy !== undefined) request.sandboxPolicy = options.sandboxPolicy
    // Forward the caller's cancellation so a cancelled tool call stops the
    // process instead of running to completion.
    if (options.signal !== undefined) request.signal = options.signal
    const spec = shell.resolve(request)
    if (typeof shell.run === 'function') {
      const result = await shell.run(spec)
      return { environment, command: command.commandLine, result }
    }
    if (typeof shell.execute === 'function') {
      const execution = await shell.execute(spec)
      const result = await execution.result()
      return { environment, command: command.commandLine, result }
    }
  }
  const { stdout, stderr } = await execFileAsync(command.command, (command.args || []).map(String), {
    cwd: workdir,
    env,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  })
  return {
    environment,
    command: command.commandLine,
    result: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      stdout: { text: stdout, truncated: false },
      stderr: { text: stderr, truncated: false },
      sandbox: undefined,
    },
  }
}

// ── Python detection for the execution-policy guard ─────────────────────────
//
// The guard is best-effort: it inspects the command text of shell-like tool
// calls and denies Python entry points when a workspace has a selected
// environment. The detector unwraps the common wrappers a model might use.

const PYTHON_ENTRY = /^(?:python\d*(?:\.\d+)*|pip\d*(?:\.\d+)*|pytest|ipython\d*(?:\.\d+)*|pypy\d*(?:\.\d+)*|python\.exe|pythonw\.exe)$/i
const SHELL_WRAPPERS = /^(?:sudo|doas|pkexec|env|xargs|nohup|time|nice|ionice|exec|command|builtin|watch|timeout|strace|ltrace)\s+/i
const RUNNERS = /^(?:uv|conda|micromamba|mamba)$/i

/** Options that consume the following token as their value, per wrapper. */
const WRAPPER_VALUE_OPTIONS = {
  sudo: ['-u', '-g', '-p', '-C', '-T', '-U', '-h', '-R', '-S', '-a', '-t', '-r'],
  doas: ['-u'],
  pkexec: ['-u', '-D'],
  env: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string', '--block-signal', '--default-signal', '--ignore-signal'],
  nice: ['-n'],
  ionice: ['-c', '-n'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  xargs: ['-I', '-n', '-P', '-L', '-d', '-a', '-E', '-o', '-s'],
  watch: ['-n', '-d', '-t', '-b', '-e', '-g'],
  strace: ['-e', '-o', '-p', '-u', '-s', '-S', '-P', '-E', '-L', '-m', '-O', '-U', '-X', '-A', '-D'],
  ltrace: ['-e', '-o', '-p', '-u', '-s', '-S', '-P', '-E', '-L', '-m', '-O', '-U', '-X', '-A', '-D'],
}

function stripLeadingAssignments(text) {
  return text.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '')
}

function skipWrapperOptions(text, wrapper) {
  let rest = text.trimStart()
  const valueOptions = WRAPPER_VALUE_OPTIONS[wrapper] || []
  for (let index = 0; index < 16; index++) {
    if (/^--\s/.test(rest)) { rest = rest.slice(2).trimStart(); break }
    const match = rest.match(/^(--\S+=\S+|--[A-Za-z-]+|-\S)(?=\s|$)/)
    if (!match) break
    const option = match[0]
    rest = rest.slice(option.length)
    if (valueOptions.includes(option)) rest = rest.replace(/^\s+\S+/, '')
    rest = rest.trimStart()
  }
  if (wrapper === 'timeout') {
    // `timeout [options] <duration> <command…>`: the duration is positional.
    rest = rest.replace(/^\S+\s+/, '')
  }
  return rest
}

function stripShellWrappers(text) {
  let current = text
  for (let index = 0; index < 8; index++) {
    const match = current.match(SHELL_WRAPPERS)
    if (!match) break
    const wrapper = match[0].trim().toLowerCase()
    current = skipWrapperOptions(current.slice(match[0].length), wrapper)
  }
  return current
}

/** Unwrap `bash -c "…"` / `sh -c '…'` into the inner command text. */
function unwrapShellCommand(text) {
  const shell = text.match(/^(?:bash|sh|zsh|dash|ksh)\s+/i)
  if (!shell) return null
  const rest = text.slice(shell[0].length)
  const flag = rest.match(/(?:^|\s)(-[A-Za-z]*c)(?=\s|$)/)
  if (!flag) return null
  const inner = rest.slice(flag.index + flag[0].length).trim()
  const quoted = inner.match(/^(['"])([\s\S]*)\1$/)
  return quoted ? quoted[2] : inner
}

/** Whether a shell command text invokes a Python interpreter or tool. */
export function shellRunsPython(command, depth = 0) {
  const source = String(command || '')
  if (!source.trim() || depth > 4) return false
  for (const rawSegment of source.split(/[;&|()]+|\n+/)) {
    const segment = rawSegment.trim()
    if (!segment) continue
    const inner = unwrapShellCommand(segment)
    if (inner !== null) {
      if (shellRunsPython(inner, depth + 1)) return true
      continue
    }
    const execMatch = segment.match(/\s-exec\s+/)
    if (execMatch) {
      const afterExec = segment.slice(segment.indexOf('-exec') + '-exec'.length).trim()
      if (shellRunsPython(afterExec, depth + 1)) return true
      continue
    }
    let stripped = stripLeadingAssignments(segment)
    stripped = stripShellWrappers(stripped)
    stripped = stripLeadingAssignments(stripped)
    if (!stripped) continue
    const tokens = stripped.split(/\s+/)
    // Skip a wrapper's own options (`xargs -I{} python …`, `env -i python …`).
    let index = 0
    while (index < tokens.length && tokens[index].startsWith('-') && tokens[index].length > 1) index++
    const first = (tokens[index] || '').replace(/^.*[\\/]/, '')
    if (PYTHON_ENTRY.test(first)) return true
    if (RUNNERS.test(first) && /^run$/i.test(tokens[index + 1] || '') && PYTHON_ENTRY.test((tokens[index + 2] || '').replace(/^.*[\\/]/, ''))) return true
  }
  return false
}

/** Extract the command text of a shell-like tool call. */
export function shellCommand(exec) {
  const name = String(exec?.name || '').toLowerCase()
  const isShellLike = name === 'bash' || name === 'shell' || name === 'powershell' || name === 'pwsh' || name.startsWith('terminal')
  if (!isShellLike) return ''
  const args = exec.arguments
  if (typeof args === 'string') return args
  if (!args || typeof args !== 'object') return ''
  return String(args.command || args.script || args.cmd || args.text || args.code || '')
}

/** The session behind a tool call, tolerating both Agent shapes. */
export function sessionOf(exec, sessions) {
  const agent = exec && exec.agent
  if (!agent) return undefined
  if (agent.session) return agent.session
  if (!agent.id || typeof sessions?.get !== 'function') return undefined
  return sessions.get(agent.id)
}

/** The active session's workspace root, or a thrown error when there is none. */
export function workspaceRoot(exec, sessions, workingDirectory) {
  const session = sessionOf(exec, sessions)
  if (!session) throw new Error('This operation requires an active session')
  const directory = typeof workingDirectory?.get === 'function' ? workingDirectory.get(session) : session.header?.cwd
  if (!directory) throw new Error('This operation requires an active workspace')
  return path.resolve(directory)
}

export function workspaceRootOrNull(exec, sessions, workingDirectory) {
  try { return workspaceRoot(exec, sessions, workingDirectory) } catch { return null }
}

/** Canonical, symlink-resolved form of an existing path. */
export function canonicalPath(value) {
  try { return realpathSync(value) } catch { return path.resolve(value) }
}

/** Only accept a path the durable workspace registry owns. */
export function registeredWorkspace(registry, requested) {
  if (typeof requested !== 'string' || !requested.trim()) return null
  const candidate = canonicalPath(requested)
  const items = typeof registry?.list === 'function' ? registry.list() : []
  for (const item of items) {
    if (item && typeof item.path === 'string' && canonicalPath(item.path) === candidate) return candidate
  }
  return null
}
