/**
 * Unit tests for the pure and shell-facing parts of the Host half.
 *
 * Run with `npm test` (or `node --test test/`). These tests never invoke
 * micromamba: they exercise path handling, config validation, Python-command
 * detection, workspace-selection validation, and the sandbox-aware runner
 * against a fake shell executor.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Config } from '../lib/config.js'
import { envName, normalizePath } from '../lib/micromamba.js'
import {
  readSelection,
  registeredWorkspace,
  resolveEnvironmentCommand,
  runInWorkspaceEnvironment,
  saveSelection,
  sessionOf,
  shellCommand,
  shellQuote,
  shellRunsPython,
} from '../lib/selection.js'

const home = os.homedir()

// ── paths and names ────────────────────────────────────────────────────────

test('sessionOf prefers the Agent session and falls back to the session registry', () => {
  const session = { id: 's1', header: { cwd: '/tmp/ws' } }
  assert.equal(sessionOf({ agent: { session } }, { get: () => undefined }), session)
  assert.equal(sessionOf({ agent: { id: 's1' } }, { get: (id) => (id === 's1' ? session : undefined) }), session)
  assert.equal(sessionOf({}, { get: () => session }), undefined)
  assert.equal(sessionOf(undefined, undefined), undefined)
})

test('normalizePath expands ~ and resolves', () => {
  assert.equal(normalizePath('~/x'), path.join(home, 'x'))
  assert.equal(normalizePath('/a/b/../c'), path.resolve('/a/c'))
  assert.equal(normalizePath(''), '')
})

test('envName uses base for the root prefix and the basename otherwise', () => {
  assert.equal(envName('/root', '/root'), 'base')
  assert.equal(envName('/root/envs/py312', '/root'), 'py312')
  assert.equal(envName('/elsewhere/mf-run', '/root'), 'mf-run')
})

// ── shell quoting and tool-command extraction ──────────────────────────────

test('shellQuote leaves safe tokens and quotes the rest', () => {
  assert.equal(shellQuote('plain'), 'plain')
  assert.equal(shellQuote('a b'), "'a b'")
  assert.equal(shellQuote("it's"), "'it'\\''s'")
  assert.equal(shellQuote(''), "''")
})

test('shellCommand reads shell-like tools only', () => {
  assert.equal(shellCommand({ name: 'bash', arguments: { command: 'python --version' } }), 'python --version')
  assert.equal(shellCommand({ name: 'terminal_send', arguments: { text: 'python --version' } }), 'python --version')
  assert.equal(shellCommand({ name: 'powershell', arguments: { command: 'python' } }), 'python')
  assert.equal(shellCommand({ name: 'read', arguments: { file_path: '/x' } }), '')
  assert.equal(shellCommand({ name: 'grep', arguments: { pattern: 'x' } }), '')
})

// ── Python detection ────────────────────────────────────────────────────────

test('shellRunsPython catches direct and wrapped invocations', () => {
  const yes = [
    'python --version',
    'python3 -c "print(1)"',
    '/opt/envs/a/bin/python --version',
    'pip install x',
    'pytest -q',
    'ipython x.py',
    'sudo python x.py',
    'sudo -u root python x.py',
    'env /abs/path/python x.py',
    'env -i python x.py',
    'env FOO=bar python x.py',
    'xargs python',
    'xargs -I{} python {}',
    'xargs -I {} python {}',
    'nohup python',
    'uv run python',
    'conda run python',
    'micromamba run python',
    'bash -c "python --version"',
    "sh -c 'sudo pip install x'",
    'find . -exec python {} ;',
    'nice -n 5 python',
    'timeout 10 python',
    'timeout -s KILL 10 python',
    'ionice -c 2 python',
    'watch -n 1 python x.py',
    'strace -f python x.py',
    'pkexec -u root python x.py',
    'exec python x.py',
  ]
  for (const command of yes) {
    assert.equal(shellRunsPython(command), true, `should detect: ${command}`)
  }
})

test('shellRunsPython rejects non-Python commands and quoted mentions', () => {
  const no = [
    'echo python',
    'ls python/',
    'git grep python',
    'echo "python --version"',
    'grep -r python src/',
    'npm run build',
    'Rscript --version',
    'FOO=bar npm run build',
    'git commit -m "python --version"',
    'xargs -I{} echo {}',
    'pythonic --help',
    '--python',
    'strace -f ls',
    'sudo -n true',
  ]
  for (const command of no) {
    assert.equal(shellRunsPython(command), false, `should not detect: ${command}`)
  }
})

// ── environment command mapping ─────────────────────────────────────────────

test('resolveEnvironmentCommand maps interpreters and leaves other commands', () => {
  const environment = {
    name: 'py312',
    path: '/root/envs/py312',
    python: '/root/envs/py312/bin/python',
    rscript: '/root/envs/py312/bin/Rscript',
  }
  assert.equal(resolveEnvironmentCommand(environment, 'python'), environment.python)
  assert.equal(resolveEnvironmentCommand(environment, 'python3.12'), environment.python)
  assert.equal(resolveEnvironmentCommand(environment, '/opt/other/bin/python'), environment.python)
  assert.equal(resolveEnvironmentCommand(environment, 'Rscript'), environment.rscript)
  assert.equal(resolveEnvironmentCommand(environment, 'ls'), 'ls')
})

// ── config schema ───────────────────────────────────────────────────────────

test('config validation applies defaults and rejects bad values', () => {
  const ok = Config['~standard'].validate({})
  assert.equal(ok.issues, undefined)
  assert.equal(ok.value.enforcePythonTool, true)
  assert.equal(ok.value.cacheTtlMs, 30000)
  assert.equal(ok.value.maxDetailEnvs, 25)
  assert.equal(ok.value.extraEnvPaths.length, 0)

  const custom = Config['~standard'].validate({ cacheTtlMs: 5000, enforcePythonTool: false })
  assert.equal(custom.value.cacheTtlMs, 5000)
  assert.equal(custom.value.enforcePythonTool, false)

  const bad = Config['~standard'].validate({ cacheTtlMs: -1 })
  assert.ok(bad.issues && bad.issues.length > 0)
})

// ── workspace selection ─────────────────────────────────────────────────────

test('readSelection ignores a selection written for another workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mm-sel-'))
  const other = await mkdtemp(path.join(os.tmpdir(), 'mm-sel-'))
  try {
    await saveSelection(root, { name: 'py312', path: '/root/envs/py312' })
    assert.equal((await readSelection(root)).environment.name, 'py312')
    assert.equal((await readSelection(other)).environment, null)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('registeredWorkspace matches only canonical registry paths', () => {
  const registry = { list: () => [{ path: '/tmp/mm-ws' }, { path: '/tmp/other' }] }
  assert.equal(registeredWorkspace(registry, '/tmp/mm-ws'), path.resolve('/tmp/mm-ws'))
  assert.equal(registeredWorkspace(registry, '/tmp/other/'), path.resolve('/tmp/other'))
  assert.equal(registeredWorkspace(registry, '/tmp/nope'), null)
  assert.equal(registeredWorkspace(registry, ''), null)
})

// ── sandbox-aware execution ─────────────────────────────────────────────────

test('runInWorkspaceEnvironment passes the sandbox policy to the shell executor', async () => {
  const calls = []
  const fakeShell = {
    resolve(request) {
      calls.push(['resolve', request])
      return { ...request, timeoutMs: request.timeoutMs }
    },
    async execute(spec) {
      calls.push(['execute', spec])
      return {
        result: async () => ({
          exitCode: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: spec.timeoutMs,
          stdout: { text: 'Python 3.12.13\n', truncated: false },
          stderr: { text: '', truncated: false },
          sandbox: spec.sandboxPolicy ? { mode: spec.sandboxPolicy.mode, denied: false } : undefined,
        }),
      }
    },
  }
  const environment = { name: 'py312', path: '/root/envs/py312', python: '/root/envs/py312/bin/python' }
  const policy = { mode: 'read-only' }
  const { result } = await runInWorkspaceEnvironment('/tmp/ws', {
    commandLine: '/root/envs/py312/bin/python --version',
    command: '/root/envs/py312/bin/python',
    args: ['--version'],
  }, { environment, shell: fakeShell, sandboxPolicy: policy })

  assert.equal(calls[0][0], 'resolve')
  assert.deepEqual(calls[0][1].sandboxPolicy, policy)
  assert.equal(calls[1][0], 'execute')
  assert.equal(calls[1][1].workdir, '/tmp/ws')
  assert.equal(result.stdout.text.trim(), 'Python 3.12.13')
  assert.equal(result.sandbox.mode, 'read-only')
})

test('runInWorkspaceEnvironment prefers the declared run(spec) seam', async () => {
  const calls = []
  const seen = []
  const fakeShell = {
    resolve(request) {
      calls.push('resolve')
      return { ...request }
    },
    async run(spec) {
      calls.push('run')
      seen.push(spec)
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: spec.timeoutMs,
        stdout: { text: 'ok\n', truncated: false },
        stderr: { text: '', truncated: false },
        sandbox: { mode: spec.sandboxPolicy.mode, denied: false },
      }
    },
    async execute() {
      calls.push('execute')
      throw new Error('execute must not be used when run() exists')
    },
  }
  const environment = { name: 'py312', path: '/root/envs/py312', python: '/root/envs/py312/bin/python' }
  const controller = new AbortController()
  const { result } = await runInWorkspaceEnvironment('/tmp/ws', {
    commandLine: '/root/envs/py312/bin/python -V',
    command: '/root/envs/py312/bin/python',
    args: ['-V'],
  }, { environment, shell: fakeShell, sandboxPolicy: { mode: 'workspace-write' }, signal: controller.signal })

  assert.deepEqual(calls, ['resolve', 'run'])
  assert.equal(seen[0].workdir, '/tmp/ws')
  assert.equal(seen[0].sandboxPolicy.mode, 'workspace-write')
  assert.equal(seen[0].signal, controller.signal, 'the caller signal reaches the executor')
  assert.equal(result.stdout.text, 'ok\n')
})

test('runInWorkspaceEnvironment falls back to execute(spec).result()', async () => {
  const fakeShell = {
    resolve: (request) => request,
    async execute(spec) {
      return { result: async () => ({ exitCode: 3, signal: null, timedOut: false, aborted: false, stdout: { text: '', truncated: false }, stderr: { text: 'boom', truncated: false } }) }
    },
  }
  const environment = { name: 'py312', path: '/root/envs/py312' }
  const { result } = await runInWorkspaceEnvironment('/tmp/ws', {
    commandLine: 'false', command: '/usr/bin/false', args: [],
  }, { environment, shell: fakeShell })
  assert.equal(result.exitCode, 3)
  assert.equal(result.stderr.text, 'boom')
})

test('runInWorkspaceEnvironment falls back to direct argv without a shell executor', async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'mm-run-'))
  try {
    const environment = { name: 'py312', path: '/root/envs/py312', python: '/root/envs/py312/bin/python' }
    const { result } = await runInWorkspaceEnvironment(workdir, {
      commandLine: 'echo hello',
      command: '/bin/echo',
      args: ['hello'],
    }, { environment, cwd: workdir })
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout.text, /hello/)
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
})
