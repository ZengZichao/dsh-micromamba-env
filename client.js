/**
 * dsh-micromamba-env — browser half.
 *
 * Registers a sidebar panel button and its main panel. The panel is read-only:
 * it lists micromamba environments (name, path, base/active/external, package
 * count, interpreter versions) and expands one environment at a time to show a
 * filterable package list. Every read travels through the Host half's
 * same-origin routes; this file never runs a command itself.
 */

window.__ModuleLoader__.load({
  id: 'dsh-micromamba-env',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React

    const ROUTE_ENVS = '/dsh-micromamba-env/envs'
    const ROUTE_PACKAGES = '/dsh-micromamba-env/packages'
    const ROUTE_ENVIRONMENTS = '/dsh-micromamba-env/environments'
    const ROUTE_SELECTION = '/dsh-micromamba-env/selection'
    const PANEL_ID = 'micromamba-env'
    const LOCALE_NS = 'dsh-micromamba-env'

    // ---------------------------------------------------------------- i18n ----
    const LOCALES = {
      zh: {
        'nav': 'Micromamba',
        'title': 'Micromamba 环境',
        'version': 'micromamba {version}',
        'refresh': '刷新',
        'loading': '正在读取…',
        'empty': '未找到环境。',
        'loadFailed': '读取失败：{message}',
        'tag.default': '默认',
        'tag.selected': '当前',
        'tag.external': '外部',
        'packagesUnit': '个软件包',
        'searchPlaceholder': '筛选软件包',
        'workspace': '工作区',
        'environment': '环境',
        'noPackages': '没有软件包。',
        'noMatches': '没有匹配项。',
        'picker.none': '未选择',
        'picker.error': '读取失败',
        'picker.label': '环境：{name}',
      },
      en: {
        'nav': 'Micromamba',
        'title': 'Environments',
        'version': 'micromamba {version}',
        'refresh': 'Refresh',
        'loading': 'Loading…',
        'empty': 'No environments found.',
        'loadFailed': 'Could not load: {message}',
        'tag.default': 'default',
        'tag.selected': 'current',
        'tag.external': 'external',
        'packagesUnit': 'packages',
        'searchPlaceholder': 'Filter packages',
        'workspace': 'Workspace',
        'environment': 'Environment',
        'noPackages': 'No packages.',
        'noMatches': 'No matches.',
        'picker.none': 'None',
        'picker.error': 'Could not load',
        'picker.label': 'Environment: {name}',
      },
    }

    let serviceT = null
    let sessionsService = null
    let uiSessionService = null
    let activeLang = 'en'
    try { activeLang = /^zh/i.test(typeof navigator !== 'undefined' ? (navigator.language || '') : '') ? 'zh' : 'en' } catch { /* keep default */ }

    function t(key, vars) {
      let text = null
      if (serviceT) {
        try {
          const value = serviceT(key)
          if (typeof value === 'string' && value.length > 0 && value !== key) text = value
        } catch { /* fall through to the built-in dictionary */ }
      }
      if (text === null) {
        const table = LOCALES[activeLang] || LOCALES.en
        text = table[key] || LOCALES.en[key] || key
      }
      if (vars) {
        for (const name of Object.keys(vars)) text = text.split('{' + name + '}').join(String(vars[name]))
      }
      return text
    }

    // --------------------------------------------------------------- styles ----
    const CSS = `
.dsh-mm{--mm-bg:#fcfcfc;--mm-fill:#f0f0f0;--mm-line:#d9d9d9;--mm-line-strong:#cecece;--mm-ink:#202020;--mm-ink-2:#646464;--mm-danger:#ce2c31;--mm-danger-bg:#feebec;--mm-danger-line:#fdbdbe;color-scheme:light;font-family:ui-sans-serif,-apple-system,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;font-size:12px;line-height:1.5;text-align:left;-webkit-font-smoothing:antialiased}
body[data-ds-dark-theme] .dsh-mm{--mm-bg:#111111;--mm-fill:#222222;--mm-line:#3a3a3a;--mm-line-strong:#484848;--mm-ink:#eeeeee;--mm-ink-2:#b4b4b4;--mm-danger:#ff9592;--mm-danger-bg:#201314;--mm-danger-line:#72232d;color-scheme:dark}
.dsh-mm,.dsh-mm *{box-sizing:border-box}
.dsh-mm-panel{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--mm-bg);color:var(--mm-ink)}
.dsh-mm-masthead{flex:none;display:flex;align-items:flex-start;gap:12px;padding:14px 16px 12px;border-bottom:0.5px solid var(--mm-line)}
.dsh-mm-masthead-main{flex:1;min-width:0}
.dsh-mm-title{margin:0;font-size:16px;font-weight:600;line-height:1.35;letter-spacing:-0.01em;color:var(--mm-ink)}
.dsh-mm-meta{margin-top:2px;font-size:12px;line-height:1.5;color:var(--mm-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-iconbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:-3px -4px 0 0;padding:0;border:0.5px solid transparent;border-radius:0;background:transparent;color:var(--mm-ink-2);cursor:pointer}
.dsh-mm-iconbtn:hover:not(:disabled){background:var(--mm-fill);border-color:var(--mm-line);color:var(--mm-ink)}
.dsh-mm-iconbtn:focus-visible{background:var(--mm-fill);border-color:var(--mm-line-strong);color:var(--mm-ink)}
.dsh-mm-iconbtn:disabled{opacity:.55;cursor:default}
.dsh-mm-context{flex:none;display:flex;flex-wrap:wrap;gap:8px 24px;padding:8px 16px;border-bottom:0.5px solid var(--mm-line)}
.dsh-mm-field{display:flex;align-items:baseline;gap:8px;flex:0 1 auto;min-width:0}
.dsh-mm-field-key{flex:none;font-size:12px;color:var(--mm-ink-2)}
.dsh-mm-field-value{min-width:0;max-width:240px;font-size:12px;font-weight:600;color:var(--mm-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-body{flex:1;min-height:0;overflow-y:auto;width:100%;max-width:760px;padding:0 16px 32px}
.dsh-mm-alert{margin:16px 0 0;padding:8px 12px;border:0.5px solid var(--mm-danger-line);background:var(--mm-danger-bg);color:var(--mm-danger);font-size:12px;word-break:break-word}
.dsh-mm-error{color:var(--mm-danger)}
.dsh-mm-row{margin:0 -16px;padding:12px 16px;border-bottom:0.5px solid var(--mm-line);cursor:pointer}
.dsh-mm-row:hover,.dsh-mm-row.is-open{background:var(--mm-fill)}
.dsh-mm-row:focus-visible{outline:none;background:var(--mm-fill)}
.dsh-mm-row-main{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0}
.dsh-mm-row-name{min-width:0;font-size:14px;font-weight:600;line-height:1.4;color:var(--mm-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-tag{flex:none;font-size:12px;line-height:1.5;letter-spacing:.04em;text-transform:uppercase;color:var(--mm-ink-2)}
.dsh-mm-row-path{margin-top:4px;font-size:12px;line-height:1.5;color:var(--mm-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-row-meta{display:flex;flex-wrap:wrap;gap:2px 12px;margin-top:2px;font-size:12px;line-height:1.5;color:var(--mm-ink-2);font-variant-numeric:tabular-nums}
.dsh-mm-detail{max-width:560px;margin:12px 0 0;cursor:default}
.dsh-mm-detail-bar{display:flex;align-items:center;gap:12px}
.dsh-mm-input{flex:1 1 0;min-width:0;height:28px;padding:0 8px;border:0.5px solid var(--mm-line-strong);border-radius:0;background:var(--mm-bg);color:var(--mm-ink);font-family:inherit;font-size:12px;line-height:1.5;appearance:none;-webkit-appearance:none}
.dsh-mm-input::placeholder{color:var(--mm-ink-2)}
.dsh-mm-input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.dsh-mm-input:focus{outline:none;border-color:var(--mm-ink-2)}
.dsh-mm-note{flex:none;font-size:12px;color:var(--mm-ink-2);font-variant-numeric:tabular-nums}
.dsh-mm-packages{margin-top:8px}
.dsh-mm-pkg{display:grid;grid-template-columns:minmax(0,1fr) auto 84px;align-items:baseline;gap:12px;padding:5px 0;border-bottom:0.5px solid var(--mm-line);font-size:12px;line-height:1.5}
.dsh-mm-pkg:last-child{border-bottom:none}
.dsh-mm-pkg-name{min-width:0;font-family:ui-monospace,"SF Mono",Menlo,monospace;color:var(--mm-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-pkg-version{color:var(--mm-ink-2);font-variant-numeric:tabular-nums}
.dsh-mm-pkg-channel{color:var(--mm-ink-2);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-empty{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:24px 0;font-size:12px;line-height:1.5;color:var(--mm-ink-2)}
.dsh-mm-empty-text{margin:0}
.dsh-mm-empty .dsh-mm-alert{margin:0}
.dsh-mm-btn{display:inline-flex;align-items:center;height:28px;padding:0 12px;border:0.5px solid var(--mm-line-strong);border-radius:0;background:transparent;color:var(--mm-ink);font-family:inherit;font-size:12px;line-height:1.5;cursor:pointer}
.dsh-mm-btn:hover{background:var(--mm-fill);border-color:var(--mm-ink-2)}
.dsh-mm-btn:focus-visible{outline:none;background:var(--mm-fill);border-color:var(--mm-ink)}
.dsh-mm-picker{position:relative;display:inline-flex;align-items:center;min-width:0;color:var(--mm-ink-2)}
.dsh-mm-picker-trigger{display:inline-flex;align-items:center;gap:6px;max-width:220px;height:28px;padding:0 6px;border:0.5px solid transparent;border-radius:0;background:transparent;color:var(--mm-ink);font-family:inherit;font-size:14px;line-height:1.4;cursor:pointer}
.dsh-mm-picker-trigger:hover,.dsh-mm-picker-trigger[aria-expanded=true]{background:var(--mm-fill);border-color:var(--mm-line)}
.dsh-mm-picker-trigger:focus-visible{outline:none;background:var(--mm-fill);border-color:var(--mm-line-strong)}
.dsh-mm-picker-icon{display:inline-flex;flex:none;color:var(--mm-ink-2)}
.dsh-mm-picker-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-picker-chevron{display:inline-flex;flex:none;color:var(--mm-ink-2)}
.dsh-mm-picker-menu{position:fixed;z-index:2147483000;width:280px;max-width:calc(100vw - 24px);max-height:320px;overflow:auto;padding:4px;border:0.5px solid var(--mm-line-strong);border-radius:0;background:var(--mm-bg)}
.dsh-mm-picker-option{display:grid;grid-template-columns:14px minmax(0,1fr);align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 8px;border:0;border-radius:0;background:transparent;color:var(--mm-ink);font-family:inherit;font-size:14px;line-height:1.4;text-align:left;cursor:pointer}
.dsh-mm-picker-option:hover{background:var(--mm-fill)}
.dsh-mm-picker-option:focus-visible{outline:none;background:var(--mm-fill)}
.dsh-mm-picker-option-copy{min-width:0}
.dsh-mm-picker-option-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mm-picker-option-name.is-current{font-weight:600}
.dsh-mm-picker-option-path{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mm-ink-2);font-size:12px}
.dsh-mm-picker-check{display:inline-flex;justify-content:flex-start;color:var(--mm-ink)}
.dsh-mm-picker-alert{margin:4px;padding:6px 8px;border:0.5px solid var(--mm-danger-line);background:var(--mm-danger-bg);color:var(--mm-danger);font-size:12px;word-break:break-word}
`

    // ----------------------------------------------------------------- data ----
    const store = {
      info: null,
      envs: null,
      error: null,
      loading: false,
      listeners: new Set(),
      emit() {
        for (const fn of this.listeners) {
          try { fn() } catch { /* a broken listener must not break the others */ }
        }
      },
      async load(force) {
        if (this.loading) return
        this.loading = true
        this.error = null
        this.emit()
        try {
          const response = await fetch(ROUTE_ENVS + (force ? '?refresh=1' : ''), { credentials: 'same-origin' })
          const body = await response.json().catch(() => null)
          if (!response.ok || !body || body.ok !== true) {
            throw new Error((body && body.error) || ('HTTP ' + response.status))
          }
          this.info = body.info || null
          this.envs = Array.isArray(body.envs) ? body.envs : []
          this.error = null
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error)
        } finally {
          this.loading = false
          this.emit()
        }
      },
    }

    function useEnvs() {
      const [state, setState] = useState(() => ({ info: store.info, envs: store.envs, error: store.error, loading: store.loading }))
      useEffect(() => {
        const listener = () => setState({ info: store.info, envs: store.envs, error: store.error, loading: store.loading })
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      }, [])
      return state
    }

    // --------------------------------------------------------------- icons ----
    function IconMamba(props) {
      const size = (props && props.size) || 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M12 3.6 20 8v8l-8 4.4L4 16V8z' }),
        h('path', { d: 'M4 8l8 4.4L20 8' }),
        h('path', { d: 'M12 12.4V20' }),
        h('path', { d: 'M8.2 6.2l7.6 4.2' }),
      )
    }

    function IconRefresh(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.5-3.7' }),
        h('path', { d: 'M13.4 2.6v2.9h-2.9' }),
      )
    }

    function IconCheck(props) {
      const size = (props && props.size) || 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      }, h('path', { d: 'M3.2 8.4l3.2 3.2 6.4-7.2' }))
    }

    /**
     * Which session owns the main view. `uiSession.current` is the binding of
     * record; the list snapshot's own `current` id and the row's `retainedBy`
     * count are accepted as fallbacks for older snapshots.
     */
    function resolveCurrentSessionId(list, uiSession) {
      try {
        const binding = uiSession && uiSession.current && uiSession.current.getSnapshot
          ? uiSession.current.getSnapshot()
          : undefined
        if (binding && typeof binding.key === 'string') return binding.key
      } catch { /* fall through to the list snapshot */ }
      if (!list || !list.byId) return undefined
      if (typeof list.current === 'string' && list.byId[list.current]) return list.current
      const retained = list.ids
        ? list.ids.find((id) => (list.byId[id] && list.byId[id].retainedBy && list.byId[id].retainedBy.mainView > 0))
        : undefined
      return retained
    }

    // ---------------------------------------------------------------- panel ----
    function MicromambaPanel() {
      const { info, envs, error, loading } = useEnvs()
      const [selected, setSelected] = useState(null)
      const [search, setSearch] = useState('')
      const [packageData, setPackageData] = useState(null)
      const [packageLoading, setPackageLoading] = useState(false)
      const [packageError, setPackageError] = useState(null)
      const packageCacheRef = useRef({})
      const [cacheVersion, setCacheVersion] = useState(0)
      const [sessionsState, setSessionsState] = useState(null)
      const [currentSelection, setCurrentSelection] = useState(null)

      useEffect(() => { void store.load() }, [])

      // Track the current workspace so the panel can show its selected environment.
      // The main view's session is authoritative (`uiSession.current`); older
      // snapshots also carried a `current` id, so both are accepted.
      useEffect(() => {
        const cleanups = []
        const sessionStore = sessionsService && sessionsService.list
        if (sessionStore && typeof sessionStore.subscribe === 'function') {
          const update = () => setSessionsState(sessionStore.getSnapshot())
          update()
          cleanups.push(sessionStore.subscribe(update))
        }
        if (uiSessionService && uiSessionService.current && typeof uiSessionService.current.subscribe === 'function') {
          const update = () => setSessionsState((previous) => (previous ? { ...previous } : previous))
          cleanups.push(uiSessionService.current.subscribe(update))
        }
        return () => { for (const dispose of cleanups) { try { dispose() } catch { /* ignore */ } } }
      }, [])

      const currentSessionId = resolveCurrentSessionId(sessionsState, uiSessionService)
      const currentCwd = sessionsState && sessionsState.byId && currentSessionId
        ? sessionsState.byId[currentSessionId]?.cwd
        : undefined

      useEffect(() => {
        if (!currentCwd) { setCurrentSelection(null); return undefined }
        let cancelled = false
        fetch(ROUTE_SELECTION + '?project=' + encodeURIComponent(currentCwd), { credentials: 'same-origin' })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!response.ok || !body || body.ok !== true) throw new Error((body && body.error) || ('HTTP ' + response.status))
            return body
          })
          .then((body) => { if (!cancelled) setCurrentSelection(body.selection || null) })
          .catch(() => { if (!cancelled) setCurrentSelection(null) })
        return () => { cancelled = true }
      }, [currentCwd, cacheVersion])

      useEffect(() => {
        if (!selected) {
          setPackageData(null)
          setPackageError(null)
          setPackageLoading(false)
          return undefined
        }
        const cached = packageCacheRef.current[selected]
        if (cached) {
          setPackageData(cached)
          setPackageError(null)
          setPackageLoading(false)
          return undefined
        }
        let cancelled = false
        setPackageLoading(true)
        setPackageError(null)
        fetch(ROUTE_PACKAGES + '?path=' + encodeURIComponent(selected), { credentials: 'same-origin' })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!response.ok || !body || body.ok !== true) throw new Error((body && body.error) || ('HTTP ' + response.status))
            return body
          })
          .then((body) => {
            if (cancelled) return
            packageCacheRef.current[selected] = body
            setPackageData(body)
            setPackageLoading(false)
          })
          .catch((err) => {
            if (cancelled) return
            setPackageError(err instanceof Error ? err.message : String(err))
            setPackageLoading(false)
          })
        return () => { cancelled = true }
      }, [selected, cacheVersion])

      const visiblePackages = useMemo(() => {
        if (!packageData || !Array.isArray(packageData.packages)) return []
        const query = search.trim().toLowerCase()
        if (!query) return packageData.packages
        return packageData.packages.filter((pkg) => {
          const name = (pkg.name || '').toLowerCase()
          const version = (pkg.version || '').toLowerCase()
          return name.includes(query) || version.includes(query)
        })
      }, [packageData, search])

      const visibleRows = Array.isArray(envs) ? envs : []

      const selectedPath = currentSelection && currentSelection.environment ? currentSelection.environment.path : ''
      const currentWorkspaceName = currentCwd ? (currentCwd.split('/').filter(Boolean).pop() || currentCwd) : ''
      const currentEnvironmentName = selectedPath
        ? ((currentSelection.environment && currentSelection.environment.name) || selectedPath)
        : t('picker.none')

      function refresh() {
        packageCacheRef.current = {}
        setCacheVersion((version) => version + 1)
        void store.load(true)
      }

      function toggle(env) {
        setSelected((current) => (current === env.path ? null : env.path))
        setSearch('')
        setPackageError(null)
      }

      const body = loading && !visibleRows.length
        ? h('div', { className: 'dsh-mm-empty' },
            h('p', { className: 'dsh-mm-empty-text' }, t('loading')),
          )
        : visibleRows.length === 0
          ? h('div', { className: 'dsh-mm-empty' },
              error
                ? h('div', { className: 'dsh-mm-alert', role: 'alert' }, t('loadFailed', { message: error }))
                : h('p', { className: 'dsh-mm-empty-text' }, t('empty')),
              h('button', { type: 'button', className: 'dsh-mm-btn', onClick: refresh }, t('refresh')),
            )
          : visibleRows.map((env) => {
              const open = selected === env.path
              const tags = []
              if (env.active) tags.push(h('span', { key: 'default', className: 'dsh-mm-tag' }, t('tag.default')))
              if (env.path === selectedPath) tags.push(h('span', { key: 'selected', className: 'dsh-mm-tag' }, t('tag.selected')))
              if (env.external) tags.push(h('span', { key: 'external', className: 'dsh-mm-tag' }, t('tag.external')))
              return h('div', {
                key: env.path,
                className: 'dsh-mm-row' + (open ? ' is-open' : ''),
                role: 'button',
                tabIndex: 0,
                'aria-expanded': open,
                onClick: () => toggle(env),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggle(env)
                  }
                },
              },
                h('div', { className: 'dsh-mm-row-main' },
                  h('span', { className: 'dsh-mm-row-name', title: env.name }, env.name),
                  tags,
                ),
                h('div', { className: 'dsh-mm-row-path', title: env.path }, env.path),
                h('div', { className: 'dsh-mm-row-meta' },
                  env.python ? h('span', null, 'Python ' + env.python) : null,
                  env.r ? h('span', null, 'R ' + env.r) : null,
                  h('span', null, env.packages == null ? '—' : env.packages + ' ' + t('packagesUnit')),
                  env.error ? h('span', { className: 'dsh-mm-error' }, t('loadFailed', { message: env.error })) : null,
                ),
                open ? h('div', { className: 'dsh-mm-detail', onClick: (event) => event.stopPropagation() },
                  h('div', { className: 'dsh-mm-detail-bar' },
                    h('input', {
                      className: 'dsh-mm-input', type: 'search', value: search,
                      placeholder: t('searchPlaceholder'),
                      'aria-label': t('searchPlaceholder'),
                      onChange: (event) => setSearch(event.target.value),
                    }),
                    h('span', { className: 'dsh-mm-note' },
                      packageLoading
                        ? t('loading')
                        : packageData
                          ? visiblePackages.length + '/' + (search.trim() ? packageData.packages.length : (packageData.total || packageData.packages.length))
                          : ''),
                  ),
                  packageError ? h('div', { className: 'dsh-mm-alert' }, t('loadFailed', { message: packageError })) : null,
                  !packageData && !packageLoading && !packageError
                    ? h('div', { className: 'dsh-mm-empty' }, h('p', { className: 'dsh-mm-empty-text' }, t('noPackages')))
                    : visiblePackages.length === 0
                      ? h('div', { className: 'dsh-mm-empty' }, h('p', { className: 'dsh-mm-empty-text' }, search.trim() ? t('noMatches') : t('noPackages')))
                      : h('div', { className: 'dsh-mm-packages' },
                          visiblePackages.map((pkg) => h('div', {
                            key: pkg.name + '@' + pkg.version + '@' + pkg.build,
                            className: 'dsh-mm-pkg',
                            title: pkg.name + ' ' + pkg.version + ' ' + pkg.build,
                          },
                            h('span', { className: 'dsh-mm-pkg-name' }, pkg.name),
                            h('span', { className: 'dsh-mm-pkg-version' }, pkg.version),
                            h('span', { className: 'dsh-mm-pkg-channel' }, pkg.channel),
                          ))),
                ) : null,
              )
            })

      return h('div', { className: 'dsh-mm dsh-mm-panel' },
        h('div', { className: 'dsh-mm-masthead' },
          h('div', { className: 'dsh-mm-masthead-main' },
            h('div', { className: 'dsh-mm-title' }, t('title')),
            info ? h('div', { className: 'dsh-mm-meta' }, t('version', { version: info.version || '?' })) : null,
          ),
          h('button', {
            type: 'button', className: 'dsh-mm-iconbtn', onClick: refresh, disabled: loading,
            'aria-label': t('refresh'), title: t('refresh'),
          }, h(IconRefresh, { size: 14 })),
        ),
        currentCwd
          ? h('div', { className: 'dsh-mm-context' },
              h('div', { className: 'dsh-mm-field' },
                h('span', { className: 'dsh-mm-field-key' }, t('workspace')),
                h('span', { className: 'dsh-mm-field-value', title: currentCwd }, currentWorkspaceName || currentCwd),
              ),
              h('div', { className: 'dsh-mm-field' },
                h('span', { className: 'dsh-mm-field-key' }, t('environment')),
                h('span', { className: 'dsh-mm-field-value' }, currentEnvironmentName),
              ),
            )
          : null,
        h('div', { className: 'dsh-mm-body' },
          error && visibleRows.length
            ? h('div', { className: 'dsh-mm-alert' }, t('loadFailed', { message: error }))
            : null,
          body,
        ),
      )

    }

    // ---------------------------------------------------------- composer picker ----
    const NOOP_HOOK = () => undefined

    /**
     * Per-workspace environment picker for the composer. Modeled on
     * dsh-conda-workspace-env-main: the selection is stored in the workspace and
     * restored when the session changes.
     */
    function EnvironmentPicker(props) {
      const sessionId = props && props.sessionId
      const sessionsHook = (props && props.useSessions) || NOOP_HOOK
      const cwd = sessionsHook((state) => (state && state.byId && sessionId ? state.byId[sessionId]?.cwd : undefined))
      const [items, setItems] = useState([])
      const [value, setValue] = useState('')
      const [error, setError] = useState('')
      const [open, setOpen] = useState(false)
      const anchorRef = useRef(null)

      useEffect(() => {
        if (!cwd) return undefined
        let active = true
        const readJson = async (response) => {
          const body = await response.json().catch(() => null)
          if (!response.ok || !body || body.ok !== true) throw new Error((body && body.error) || ('HTTP ' + response.status))
          return body
        }
        Promise.all([
          fetch(ROUTE_ENVIRONMENTS, { credentials: 'same-origin' }).then(readJson),
          fetch(ROUTE_SELECTION + '?project=' + encodeURIComponent(cwd), { credentials: 'same-origin' }).then(readJson),
        ]).then(([environmentsBody, selectionBody]) => {
          if (!active) return
          setItems(Array.isArray(environmentsBody.environments) ? environmentsBody.environments : [])
          setValue(selectionBody.selection?.environment?.path || '')
          setError('')
        }).catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        })
        return () => { active = false }
      }, [cwd])

      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => { if (!anchorRef.current?.contains(event.target)) setOpen(false) }
        const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      async function save(prefix) {
        setValue(prefix)
        setOpen(false)
        setError('')
        try {
          const response = await fetch(ROUTE_SELECTION, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ project: cwd, path: prefix }),
            credentials: 'same-origin',
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || !body || body.ok !== true) throw new Error((body && body.error) || ('HTTP ' + response.status))
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }

      const selected = items.find((item) => item.path === value)
      const rect = open ? anchorRef.current?.getBoundingClientRect() : null
      const options = [{ name: t('picker.none'), path: '', source: 'none' }, ...items]
      const width = 280

      return h('span', { ref: anchorRef, className: 'dsh-mm dsh-mm-picker' },
        h('button', {
          type: 'button',
          className: 'dsh-mm-picker-trigger',
          'aria-label': error ? t('picker.error') : t('picker.label', { name: selected ? selected.name : t('picker.none') }),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setOpen((current) => !current),
        },
          h('span', { className: 'dsh-mm-picker-icon', 'aria-hidden': true }, h(IconMamba, { size: 14 })),
          h('span', { className: 'dsh-mm-picker-value' }, error ? t('picker.error') : (selected ? selected.name : t('picker.none'))),
          h('svg', {
            width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none',
            className: 'dsh-mm-picker-chevron', 'aria-hidden': true,
          }, h('path', { d: 'M3 4.5 6 7.5 9 4.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
        ),
        open && rect
          ? h('div', {
              className: 'dsh-mm-picker-menu',
              role: 'menu',
              style: {
                left: (Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))) + 'px',
                bottom: (window.innerHeight - rect.top + 8) + 'px',
              },
            },
              error
                ? h('div', { className: 'dsh-mm-picker-alert', role: 'alert' }, error)
                : null,
              options.map((item) => h('button', {
                key: item.path || 'none',
                type: 'button',
                className: 'dsh-mm-picker-option',
                role: 'menuitemradio',
                'aria-checked': value === item.path,
                onClick: () => { void save(item.path) },
              },
                h('span', { className: 'dsh-mm-picker-check', 'aria-hidden': true }, value === item.path ? h(IconCheck, { size: 14 }) : null),
                h('span', { className: 'dsh-mm-picker-option-copy' },
                  h('span', { className: 'dsh-mm-picker-option-name' + (value === item.path ? ' is-current' : '') }, item.name),
                  item.path ? h('span', { className: 'dsh-mm-picker-option-path' }, item.path) : null,
                ),
              )),
            )
          : null,
      )
    }

    // ------------------------------------------------------------ exports ------
    exports.name = 'dsh-micromamba-env'
    exports.inject = ['slots', 'locale']
    exports.apply = function apply(ctx) {
      // `sessions` and `uiSession` are optional: without either, the panel still
      // lists environments, it just cannot show the current workspace section.
      ctx.inject(['sessions'], (scope) => {
        sessionsService = scope.sessions ?? null
        uiSessionService = typeof scope.get === 'function' ? (scope.get('uiSession') ?? null) : null
        return undefined
      })

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-micromamba-env'
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, 'dsh-micromamba-env: styles')

      ctx.inject(['locale'], (scope) => {
        try { scope.locale.register(LOCALE_NS, LOCALES) } catch { /* a missing dictionary is not fatal */ }
        try {
          const bound = scope.locale.bind(LOCALE_NS)
          if (typeof bound === 'function') serviceT = bound
        } catch { /* keep the built-in dictionary */ }
        const read = (snapshot) => {
          if (snapshot && snapshot.active) activeLang = snapshot.active
        }
        try { read(scope.locale.getSnapshot()) } catch { /* keep the browser language */ }
        try { return scope.on('locale/change', read) } catch { return undefined }
      })

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PANEL_ID, order: 8, label: () => t('nav'),
      }, IconMamba))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: PANEL_ID,
      }, MicromambaPanel))

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'micromamba-env-picker',
        order: 2,
        label: () => t('nav'),
        // Session-scoped slots hand their binder to `inject`; declare the one
        // prop this component reads instead of relying on slot plumbing.
        inject: (sessionId) => ({ sessionId }),
      }, EnvironmentPicker))
    }

    return module.exports
  },
})
