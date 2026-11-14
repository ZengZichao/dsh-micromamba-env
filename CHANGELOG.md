# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-14

### Added

- Sidebar panel listing every micromamba environment with name, absolute path,
  `default` / `current` / `external` flags, package count, and Python/R version.
- Expandable package browser with a name/version filter for each environment.
- Per-workspace environment selection: a composer picker persists one
  environment per workspace in `<workspace>/.context/micromamba-environment.json`
  and restores it when the workspace changes.
- Read-only agent tools: `micromamba_list_envs`, `micromamba_list_packages`,
  `micromamba_info`, `micromamba_workspace_environment`, and `micromamba_run`.
- Sandboxed execution: `micromamba_run` goes through the same shell executor as
  the Bash tool and applies the session's resolved `sandboxPolicy`.
- Execution policy that denies Python commands through Bash while a workspace
  has a selected environment and redirects them to `micromamba_run`.
- Configuration for the micromamba executable, root prefix, extra environment
  paths, detail/package caps, per-command timeout, caching, and the policy.
- English and Chinese locale metadata.
- CI checks for syntax, manifests, the bundle patch, packaging, and tests.
