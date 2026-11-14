/**
 * Browser-half registration test.
 *
 * `client.js` is a bundle body: it hands its factory to the platform's module
 * loader and never exports anything itself. This test stands in for that
 * loader with a minimal `window`/`document`/React, runs `apply`, and checks the
 * three slot registrations and their options.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'client.js'), 'utf8')

/** Load client.js as the platform loader would, returning the plugin exports. */
function loadClientHalf() {
  const registrations = []
  let plugin = null

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'Fragment',
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
  }

  const styleTags = []
  globalThis.document = {
    head: { appendChild: (node) => styleTags.push(node) },
    createElement: () => ({ dataset: {}, remove: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => { plugin = factory((name) => (name === 'react' ? react : {})) },
    },
  }
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

  // eslint-disable-next-line no-new-func
  new Function(source)()

  const ctx = {
    effect: (run) => { run(); return () => {} },
    inject: (deps, callback) => {
      if (deps.includes('sessions')) callback({ sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} } }, get: () => undefined })
      if (deps.includes('locale')) {
        callback({
          locale: { register: () => {}, bind: () => (key) => key, getSnapshot: () => ({ active: 'zh' }) },
          on: () => () => {},
        })
      }
      return () => {}
    },
    get: () => undefined,
    on: () => () => {},
    slots: {
      inject: (_name, callback) => { callback() },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  assert.equal(plugin.id ?? 'dsh-micromamba-env', 'dsh-micromamba-env')
  plugin.apply(ctx)
  return { plugin, registrations, styleTags }
}

test('the browser half loads through the module loader and declares its services', () => {
  const { plugin } = loadClientHalf()
  assert.equal(plugin.name, 'dsh-micromamba-env')
  assert.ok(Array.isArray(plugin.inject))
  assert.ok(plugin.inject.includes('slots'))
})

test('apply registers the panel icon, the main panel, and the composer picker', () => {
  const { registrations, styleTags } = loadClientHalf()
  const names = registrations.map((entry) => entry.options.name)
  assert.deepEqual(names, ['sidebar.panellist', 'main', 'conversation.input.left'])
  assert.equal(styleTags.length, 1, 'the panel stylesheet is installed once')

  const icon = registrations[0].options
  assert.equal(icon.id, 'micromamba-env')
  assert.equal(typeof icon.order, 'number')
  assert.equal(typeof icon.label, 'function')

  const panel = registrations[1].options
  assert.equal(panel.key, 'micromamba-env')

  const picker = registrations[2].options
  assert.equal(picker.id, 'micromamba-env-picker')
  assert.deepEqual(picker.inject('s-1'), { sessionId: 's-1' })
  for (const entry of registrations) assert.equal(typeof entry.component, 'function')
})
