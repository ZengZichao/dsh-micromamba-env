/**
 * dsh-micromamba-env — Host half.
 *
 * View micromamba environments and select one per workspace. The Host shells
 * out to `micromamba` for the read-only `env list` / `info` / `list` queries;
 * the browser half only reads same-origin JSON routes.
 *
 * Layout:
 *   lib/config.js     configuration schema
 *   lib/micromamba.js executable discovery and micromamba reads
 *   lib/selection.js  per-workspace selection, execution, and the policy guard
 *   index.js          plugin entry: tools, routes, system-prompt section
 */

import { micromambaInfo, listEnvs, listPackages, micromambaEnvironments, resolveEnvPath, resolveMicromamba, resolveRootPrefix } from './lib/micromamba.js'
import { readSelection, registeredWorkspace, resolveEnvironmentCommand, runInWorkspaceEnvironment, saveSelection, selectedEnvironment, sessionOf, shellCommand, shellQuote, shellRunsPython, workspaceRoot, workspaceRootOrNull } from './lib/selection.js'
import { Config } from './lib/config.js'

export { Config }

export const name = 'dsh-micromamba-env'

/**
 * Hard dependencies, all shipped with this profile. `webServer`,
 * `workspaceRegistry`, `shell`, and `sandboxPolicy` are optional and pulled in
 * through `ctx.inject` / `ctx.get` below.
 */
export const inject = ['tools', 'sessions', 'workingDirectory', 'systemPrompt']

const ROUTE_ENVS = '/dsh-micromamba-env/envs'
const ROUTE_PACKAGES = '/dsh-micromamba-env/packages'
const ROUTE_ENVIRONMENTS = '/dsh-micromamba-env/environments'
const ROUTE_SELECTION = '/dsh-micromamba-env/selection'

// ── HTTP route helpers ──────────────────────────────────────────────────────

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Accept the desktop document origin, a real same-origin request, or a non-browser caller. */
function isTrustedRequest(request) {
  const origin = request.headers ? request.headers.origin : undefined
  if (origin === undefined) return true
  if (origin === 'dsh-app://app') return true
  const host = request.headers ? request.headers.host : undefined
  if (host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}

function requestUrl(request) {
  try { return new URL(request.url || '/', 'http://localhost') } catch { return null }
}

/** Read a bounded JSON request body; resolves to {} for an empty body. */
function readJsonBody(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = []
    let total = 0
    request.on('data', (part) => {
      total += part.length
      if (total > maxBytes) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      parts.push(part)
    })
    request.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('invalid JSON body')) }
    })
    request.on('error', reject)
  })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function optionalService(ctx, name) {
  try { return ctx.get ? ctx.get(name) : undefined } catch { return undefined }
}

/** Render a shell run result as a readable report. */
function formatRunResult(result) {
  if (!result) return '(no result)'
  const lines = []
  const sandbox = result.sandbox
  if (sandbox?.denied) lines.push(`[sandbox: file access denied under ${sandbox.mode} mode]`)
  if (sandbox?.runnerFailed) lines.push('[sandbox: the sandbox runner itself failed; the command did not run]')
  lines.push(`exit code: ${result.exitCode ?? 'n/a'}`)
  if (result.signal) lines.push(`signal: ${result.signal}`)
  if (result.timedOut) lines.push(`timed out after ${result.timeoutMs} ms`)
  const stdout = result.stdout?.text || ''
  const stderr = result.stderr?.text || ''
  if (stdout) lines.push('--- stdout ---', stdout)
  if (result.stdout?.truncated) lines.push('(stdout truncated)')
  if (stderr) lines.push('--- stderr ---', stderr)
  if (result.stderr?.truncated) lines.push('(stderr truncated)')
  return lines.join('\n').trimEnd()
}

// ── plugin entry ────────────────────────────────────────────────────────────

export async function apply(ctx, config) {
  const binary = resolveMicromamba(config.micromambaPath)
  const rootPrefix = resolveRootPrefix(config.rootPrefix)
  const timeoutMs = config.timeoutMs
  const extraEnvPaths = Array.isArray(config.extraEnvPaths) ? config.extraEnvPaths : []
  const cacheTtlMs = config.cacheTtlMs

  // The sandboxing shell executor confines commands the same way the Bash tool
  // does; capture it when the composition mounts one.
  let shellService = null
  ctx.inject(['shell'], (scope) => {
    shellService = scope.shell ?? null
    return undefined
  })
  const sandboxPolicy = optionalService(ctx, 'sandboxPolicy')

  const caches = new Map()
  async function cachedListEnvs(key, force, maxDetailEnvs) {
    const now = Date.now()
    const entry = caches.get(key)
    if (!force && entry && now - entry.at < cacheTtlMs) return entry.value
    const value = await listEnvs(binary, rootPrefix, timeoutMs, extraEnvPaths, maxDetailEnvs)
    caches.set(key, { value, at: now })
    return value
  }

  async function handleEnvs(force) {
    try {
      const result = await cachedListEnvs('envs', force, config.maxDetailEnvs)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async function handlePackages(url) {
    if (!url) return { ok: false, error: 'invalid request' }
    const envPath = url.searchParams.get('path') || ''
    const search = url.searchParams.get('search') || ''
    if (!envPath) return { ok: false, error: 'missing path' }
    try {
      const result = await listPackages(binary, rootPrefix, envPath, search, timeoutMs, config.maxPackages)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async function handleEnvironments(force) {
    try {
      const { envs } = await cachedListEnvs('environments', force, 1)
      return { ok: true, environments: envs.map((env) => ({ name: env.name, path: env.path, source: 'micromamba' })) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async function handleSelectionGet(url, registry) {
    if (!url) return { ok: false, error: 'invalid request' }
    const root = registeredWorkspace(registry, url.searchParams.get('project') || '')
    if (!root) return { ok: false, error: 'Workspace is not registered' }
    try {
      return { ok: true, selection: await readSelection(root) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async function handleSelectionPost(body, registry) {
    const root = registeredWorkspace(registry, body && typeof body.project === 'string' ? body.project : '')
    if (!root) return { ok: false, error: 'Workspace is not registered' }
    try {
      const requested = body && typeof body.path === 'string' ? body.path.trim() : ''
      if (!requested) return { ok: true, selection: await saveSelection(root, null) }
      const environments = await micromambaEnvironments(binary, rootPrefix, timeoutMs, extraEnvPaths)
      const selected = environments.find((item) => item.path === requested)
      if (!selected) return { ok: false, error: 'Unknown micromamba environment' }
      return { ok: true, selection: await saveSelection(root, selected) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  const textOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', description: 'Human-readable report.' } },
      required: ['text'],
    },
    render: (_args, value) => [{ type: 'text', text: value && typeof value.text === 'string' ? value.text : '' }],
  }

  const listEnvsTool = {
    name: 'micromamba_list_envs',
    description:
      'List micromamba environments on this machine (read-only). For each environment returns its name, absolute path, base/default/external flags, package count, and Python or R version when installed. Use this first to discover environment names before micromamba_list_packages.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput,
    async execute() {
      const result = await listEnvs(binary, rootPrefix, timeoutMs, extraEnvPaths, config.maxDetailEnvs)
      const lines = []
      const info = result.info || {}
      lines.push(`micromamba ${info.version || 'unknown'} — root: ${info.rootPrefix || '(default)'} — platform: ${info.platform || 'unknown'}`)
      if (!result.envs.length) {
        lines.push('No micromamba environments found.')
      } else {
        lines.push(`Environments (${result.envs.length}):`)
        for (const env of result.envs) {
          const flags = [env.isBase ? 'base' : '', env.active ? 'default' : '', env.external ? 'external' : ''].filter(Boolean).join(', ')
          const meta = [
            env.packages == null ? '' : `${env.packages} packages`,
            env.python ? `Python ${env.python}` : '',
            env.r ? `R ${env.r}` : '',
          ].filter(Boolean).join(' · ')
          lines.push(`- ${env.name}${flags ? ` (${flags})` : ''}: ${env.path}${meta ? ` — ${meta}` : ''}`)
        }
      }
      return { text: lines.join('\n') }
    },
  }

  const listPackagesTool = {
    name: 'micromamba_list_packages',
    description:
      'List installed packages in one micromamba environment (read-only). `env` accepts an environment name or an absolute path (see micromamba_list_envs). Optional `search` filters by package name or version. Returns package, version, build, and channel columns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        env: { type: 'string', description: 'Environment name or absolute path.' },
        search: { type: 'string', description: 'Optional filter matched against package name or version.' },
      },
      required: ['env'],
    },
    output: textOutput,
    async execute(args) {
      const env = typeof args.env === 'string' ? args.env.trim() : ''
      if (!env) throw new Error('micromamba_list_packages: env is required')
      const resolved = await resolveEnvPath(env, binary, rootPrefix, timeoutMs, extraEnvPaths)
      if (!resolved) throw new Error(`micromamba_list_packages: unknown environment "${env}"`)
      const search = typeof args.search === 'string' ? args.search : ''
      const result = await listPackages(binary, rootPrefix, resolved, search, timeoutMs, config.maxPackages)
      const lines = [`Packages in ${resolved} (${result.total} total${result.truncated ? `, showing first ${result.packages.length}` : ''}):`]
      for (const pkg of result.packages) {
        lines.push(`${pkg.name}\t${pkg.version}\t${pkg.build}\t${pkg.channel}`)
      }
      return { text: lines.join('\n') }
    },
  }

  const infoTool = {
    name: 'micromamba_info',
    description:
      'Show the micromamba installation this plugin uses (read-only): executable path, version, root prefix, platform, and configured environment directories. Call this when a micromamba tool fails, to confirm which binary and root prefix are in effect.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput,
    async execute() {
      const info = await micromambaInfo(binary, rootPrefix, timeoutMs)
      const lines = [
        `Binary: ${info.binary}`,
        `Version: ${info.version || 'unknown'}`,
        `Root prefix: ${info.rootPrefix || '(micromamba default)'}`,
        `Platform: ${info.platform || 'unknown'}`,
      ]
      if (info.envsDirs.length) lines.push(`Environment directories: ${info.envsDirs.join(', ')}`)
      if (info.error) lines.push(`Warning: ${info.error}`)
      return { text: lines.join('\n') }
    },
  }

  const workspaceEnvironmentTool = {
    name: 'micromamba_workspace_environment',
    description:
      'Read or persist the micromamba environment selected for the active workspace. Omit `path` to read the current selection. Pass an exact environment path (see micromamba_list_envs) to select it, or an empty string to clear the selection. The choice is stored in the workspace and restored when you switch workspaces.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Exact environment path. Omit to read; empty string clears.' },
      },
    },
    output: textOutput,
    async execute(args, exec) {
      const root = workspaceRoot(exec, ctx.sessions, ctx.workingDirectory)
      const hasPath = Object.prototype.hasOwnProperty.call(args || {}, 'path')
      if (!hasPath) return { text: JSON.stringify(await readSelection(root), null, 2) }
      const requested = typeof args.path === 'string' ? args.path.trim() : ''
      if (!requested) return { text: JSON.stringify(await saveSelection(root, null), null, 2) }
      const environments = await micromambaEnvironments(binary, rootPrefix, timeoutMs, extraEnvPaths)
      const selected = environments.find((item) => item.path === requested)
      if (!selected) throw new Error(`Unknown micromamba environment: ${requested}`)
      return { text: JSON.stringify(await saveSelection(root, selected), null, 2) }
    },
  }

  const runTool = {
    name: 'micromamba_run',
    description:
      "Run a command line in the micromamba environment selected for the active workspace. `python`/`python3` and `Rscript` resolve to that environment's interpreters, and user site-packages are disabled. Shell operators work, and the command is confined by the session's sandbox policy exactly like Bash. Use this instead of Bash for Python whenever a workspace has a selected environment.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string', description: 'Executable name or path.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
        timeout: { type: 'integer', description: 'Timeout in milliseconds (1000-120000).' },
      },
      required: ['command'],
    },
    // The shell executor caps the command at 120s; the tool deadline sits just
    // above it so the executor, not the registry, owns the first timeout.
    timeoutMs: 150000,
    output: textOutput,
    async execute(args, exec) {
      const root = workspaceRoot(exec, ctx.sessions, ctx.workingDirectory)
      const commandName = typeof args.command === 'string' ? args.command : ''
      if (!commandName) throw new Error('micromamba_run: command is required')
      const commandArgs = (Array.isArray(args.args) ? args.args : []).map(String)
      const environment = await selectedEnvironment(root)
      if (!environment) throw new Error('No micromamba environment is selected for this workspace')
      const resolvedCommand = resolveEnvironmentCommand(environment, commandName)
      const commandLine = [resolvedCommand, ...commandArgs].map(shellQuote).join(' ')
      const session = sessionOf(exec, ctx.sessions)
      const policy = typeof sandboxPolicy?.resolve === 'function' ? sandboxPolicy.resolve(session ? { session } : {}) : undefined
      const { result } = await runInWorkspaceEnvironment(root, { commandLine, command: resolvedCommand, args: commandArgs }, {
        timeout: args.timeout,
        environment,
        shell: shellService,
        sandboxPolicy: policy,
        signal: exec?.signal,
      })
      return { text: formatRunResult(result) }
    },
  }

  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(listEnvsTool),
      ctx.tools.register(listPackagesTool),
      ctx.tools.register(infoTool),
      ctx.tools.register(workspaceEnvironmentTool),
      ctx.tools.register(runTool),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-micromamba-env: tools')

  ctx.systemPrompt.section({
    name: 'dsh-micromamba-env:execution-policy',
    order: 98,
    text: 'When the active workspace has a micromamba environment selected, run Python commands with micromamba_run, never with Bash. Treat micromamba_workspace_environment as the source of truth for the selected environment. Use Bash only when no environment is selected or for commands that do not require the selected Python environment. micromamba_run disables user site-packages, so its reported interpreter and imports reflect the selected environment.',
  })

  if (config.enforcePythonTool) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const command = shellCommand(exec)
      if (!command || !shellRunsPython(command)) return next()
      const root = workspaceRootOrNull(exec, ctx.sessions, ctx.workingDirectory)
      if (!root) return next()
      let selected = false
      try { selected = (await selectedEnvironment(root)) !== null } catch { selected = false }
      if (!selected) return next()
      return {
        kind: 'deny',
        reason: 'Python execution through Bash is disabled while this workspace has a micromamba environment selected. Retry with micromamba_run so the selected interpreter is enforced.',
      }
    }, { prepend: true })
  }

  // The panel and the composer picker read over same-origin HTTP; the routes
  // are optional so a profile without webServer still gets the agent tools.
  ctx.inject(['webServer', 'workspaceRegistry'], (host) => {
    host.effect(() => {
      const disposeEnvs = host.webServer.register({
        kind: 'exact',
        path: ROUTE_ENVS,
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          if (!isTrustedRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'untrusted origin' })
            return
          }
          const url = requestUrl(request)
          sendJson(response, 200, await handleEnvs(Boolean(url && url.searchParams.get('refresh'))))
        },
      })
      const disposePackages = host.webServer.register({
        kind: 'exact',
        path: ROUTE_PACKAGES,
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          if (!isTrustedRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'untrusted origin' })
            return
          }
          sendJson(response, 200, await handlePackages(requestUrl(request)))
        },
      })
      const disposeEnvironments = host.webServer.register({
        kind: 'exact',
        path: ROUTE_ENVIRONMENTS,
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          if (!isTrustedRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'untrusted origin' })
            return
          }
          const url = requestUrl(request)
          sendJson(response, 200, await handleEnvironments(Boolean(url && url.searchParams.get('refresh'))))
        },
      })
      const disposeSelection = host.webServer.register({
        kind: 'exact',
        path: ROUTE_SELECTION,
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'POST') {
            response.writeHead(405, { allow: 'GET, POST' })
            response.end()
            return
          }
          if (!isTrustedRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'untrusted origin' })
            return
          }
          const url = requestUrl(request)
          if (request.method === 'GET') {
            sendJson(response, 200, await handleSelectionGet(url, host.workspaceRegistry))
            return
          }
          let body
          try {
            body = await readJsonBody(request)
          } catch (error) {
            sendJson(response, 400, { ok: false, error: errorMessage(error) })
            return
          }
          sendJson(response, 200, await handleSelectionPost(body, host.workspaceRegistry))
        },
      })
      return () => {
        disposeEnvs()
        disposePackages()
        disposeEnvironments()
        disposeSelection()
      }
    }, 'dsh-micromamba-env: routes')
  })
}
