# dsh-micromamba-env

See every micromamba environment on this machine, keep one selected per
workspace, and let the agent run Python inside that environment. The catalog is
strictly read-only: this plugin never installs, removes, or upgrades a package.

## Quick start

You need `micromamba` on this machine and write access to
`~/.dsh/profiles/desktop`.

1. Run `micromamba --version` and note the version.
2. Link the checkout into the desktop profile:
   ```sh
   cd /path/to/dsh-micromamba-env
   ln -sfn "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-micromamba-env
   ```
3. Add `"dsh-micromamba-env"` to `dsh.profile.bundles` in
   `~/.dsh/profiles/desktop/package.json`.
   > A link alone is not enough: without this entry the Loader never mounts the
   > row, and the sidebar shows nothing. This is the most common failed install.
4. Quit DeepSeek Harness completely, reopen it, then click **Micromamba** in the
   sidebar.

**Result:** the panel is titled **Micromamba 环境** (or **Environments** in an
English UI), shows `micromamba <version>` under the title, and lists one row per
environment.

Verify the wiring any time with `npm run check:runtime`; it ends in
`manifest and runtime checks passed` and reports where the profile link points.

Full walkthrough: [docs/install.md](./docs/install.md).

## Documentation

The help articles are written in Chinese, matching the UI labels they tell you to
click. Start at [docs/README.md](./docs/README.md) if you are not sure which one
you need.

| Task | Article |
| --- | --- |
| Install and open the panel | [安装并在侧边栏打开 Micromamba 面板](./docs/install.md) |
| Read the environment list | [查看本机的 micromamba 环境](./docs/view-environments.md) |
| Inspect an environment's packages | [查看某个环境里装了哪些软件包](./docs/browse-packages.md) |
| Select one environment per workspace | [为当前工作区选择 micromamba 环境](./docs/select-environment.md) |
| Run Python or R in the selected environment | [用所选环境运行 Python 或 R 命令](./docs/run-python.md) |
| Ask the agent to list or run things | [让智能体查询环境、软件包并执行命令](./docs/agent-tools.md) |
| Configure the binary, root prefix, limits | [配置 micromamba 路径、根前缀与其他选项](./docs/configure.md) |
| Understand `default` / `current` / `external` | [理解"默认""当前""外部"三个标签与只读边界](./docs/concepts.md) |
| Fix a broken panel, picker, or policy denial | [故障排除](./docs/troubleshooting.md) |
| Short answers | [常见问题](./docs/faq.md) |

## How it works

- **Host half** (`index.js`) shells out to `micromamba` for three read-only
  queries: `env list --json`, `info --json`, and `list -p <env> --json`.
- **Browser half** (`client.js`) only fetches same-origin JSON from
  `/dsh-micromamba-env/envs`, `/packages`, `/environments`, and `/selection`.
  It never runs a command.
- **Selection** lives in `<workspace>/.context/micromamba-environment.json` and
  is written on every change; a selection whose recorded `workspace` no longer
  matches the directory is treated as "nothing selected".
- **Execution policy**: while a workspace has a selection and
  `enforcePythonTool` is `true` (the default), Python submitted through Bash is
  denied and redirected to `micromamba_run`. The detector unwraps the usual
  wrappers — `sudo`, `env`, `xargs`, `nohup`, `nice`, `timeout`, `strace`,
  `bash -c`, and more — and also recognises `pip`, `pytest`, `ipython`, `pypy`,
  and `uv|conda|micromamba|mamba run python`. It inspects `terminal_send` too.

> The detector is best-effort: it reads the command text of shell-like tool
> calls, and a determined caller can always find a new wrapper. Treat it as a
> guardrail for the model, not a security boundary. The enforced boundary is the
> sandbox policy that `micromamba_run` passes to the same shell executor the Bash
> tool uses.

## Configuration

Row config is read once at load, so changes need a restart. Defaults are usually
enough; see [docs/configure.md](./docs/configure.md) for the Chinese walkthrough
and the discovery order.

| Field | Default | Range | Meaning |
| --- | --- | --- | --- |
| `micromambaPath` | `""` | path | Absolute path to `micromamba`. Empty auto-detects: `$MICROMAMBA` / `$MAMBA_EXE`, `~/bin`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, then `PATH`. |
| `rootPrefix` | `""` | path | Root prefix (`-r`). Empty uses `$MAMBA_ROOT_PREFIX`, then micromamba's own default. |
| `extraEnvPaths` | `[]` | strings | Extra environment paths to list even when `env list` omits them. |
| `maxDetailEnvs` | `25` | 1–200 | How many environments get a package count and interpreter versions. |
| `maxPackages` | `20000` | 1–50000 | Hard cap on one package query. |
| `timeoutMs` | `30000` | 1000–120000 | Per-command timeout for the read queries (not for `micromamba_run`). |
| `enforcePythonTool` | `true` | boolean | Deny Python through Bash while a workspace has a selection. |
| `cacheTtlMs` | `30000` | 0–3600000 | Environment-list cache lifetime; **刷新** bypasses it. |

Patch the row in the profile's `cordis.patch.yml`:

```yaml
- id: micromamba-env
  name: dsh-micromamba-env
  config:
    rootPrefix: /Users/you/.local/share/mamba
```

## Compatibility

Built against **DeepSeek Harness 0.2.2-rc.3**, the runtime shipped in the
desktop app (`app.asar/dsh`). `dsh.harness` declares a `>=0.2.0` floor.

| Layer | Contract |
| --- | --- |
| Host entry | `export const inject = ['tools', 'sessions', 'workingDirectory', 'systemPrompt']`; optional `shell` (`ctx.inject`), `sandboxPolicy` and `workspaceRegistry` (`ctx.get`) |
| Tools | `ctx.tools.register({ name, parameters, output, execute })` inside `ctx.effect`; `output.render(args, value)` returns text blocks |
| Guard | `ctx.on('tools/pre-execute', (exec, next) => …)` returning `{ kind: 'deny', reason }` |
| Prompt | `ctx.systemPrompt.section({ name, order, text })` |
| Web | `host.webServer.register({ kind: 'exact', path, handler })` on same-origin JSON routes |
| Workspaces | `host.workspaceRegistry.list()`, `ctx.workingDirectory.get(session)`, `session.header.cwd` |
| Sandbox | `sandboxPolicy.resolve({ session })`, `shell.resolve(request)` → `shell.run(spec)` / `shell.execute(spec).result()` |
| Client | `window.__ModuleLoader__.load({ id, factory })`, `exports.inject`, `ctx.slots.inject` + `ctx.slots.register`, `ctx.locale.register/bind/getSnapshot` |

The browser half registers into `sidebar.panellist`, `main`, and
`conversation.input.left`. `dsh-app://app` is accepted as the desktop renderer's
origin, matching the app's `forwardWebRequest`, which strips `Origin` before
proxying. `npm run check:runtime` reads `dsh/package.json` out of the installed
`app.asar`, compares it with the declared floor, validates the `dsh.client` /
`dsh.bundle` declarations, and reports a profile link that points elsewhere.

## Development

```
index.js          plugin entry: tools, HTTP routes, system-prompt section
lib/config.js     configuration schema
lib/micromamba.js executable discovery and micromamba reads
lib/selection.js  per-workspace selection, execution, and the policy guard
client.js         sidebar panel + composer picker
scripts/          check-runtime-compat.mjs — manifest + installed-runtime audit
test/             unit and manifest-contract tests (`npm test`)
```

`npm test` runs the unit and contract suites; `npm run check:runtime` audits the
manifest against the app build installed on this machine.

## Notes

- `default` comes from `micromamba info --json`'s `env location`, i.e. the
  environment micromamba resolves in the Harness process. It is not a live view
  of a terminal you activated elsewhere. `current` is the workspace's own
  choice; `external` marks an environment outside the root prefix.
- Environments beyond `maxDetailEnvs` still appear, just without a package count.
- The bundle has no static dependencies outside Node's standard library. The
  config schema prefers `@deepseek-ai/schemastery` when the profile can supply
  it, loaded by absolute path, and otherwise falls back to a built-in Standard
  Schema with the same defaults and checks.
- `micromamba_run` maps `python` / `python3` / `python.exe` and `Rscript` onto
  the selected environment's interpreters, prefixes `PATH` with the environment's
  `bin`, sets `CONDA_PREFIX` and `CONDA_DEFAULT_ENV`, and sets
  `PYTHONNOUSERSITE=1`.

## License

MIT
