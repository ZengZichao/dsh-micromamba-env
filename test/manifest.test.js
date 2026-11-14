/**
 * Contract tests for the pieces the Harness Loader reads: the package manifest,
 * the bundle patch, the Host entry's service declarations, and the Client
 * entry's slot registrations.
 *
 * These assert the shape current Harness builds parse, without needing the
 * application installed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const host = readFileSync(path.join(root, 'index.js'), 'utf8')
const client = readFileSync(path.join(root, 'client.js'), 'utf8')
const patch = readFileSync(path.join(root, manifest.dsh.bundle.patch), 'utf8')

test('dsh.client declares the browser half the Loader parses', () => {
  const declaration = manifest.dsh.client
  assert.equal(declaration.platform, 'web')
  assert.equal(typeof declaration.immediately, 'boolean')
  assert.ok(Array.isArray(declaration.inject) && declaration.inject.every((entry) => typeof entry === 'string'))
  assert.deepEqual(manifest.exports['./client'], './client.js')
  assert.ok(existsSync(path.join(root, 'client.js')))
})

test('the bundle patch inserts exactly this package as a row', () => {
  assert.match(patch, /^\s*-\s*insert:/m)
  const names = [...patch.matchAll(/^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1].trim())
  assert.deepEqual(names, [manifest.name])
  const ids = [...patch.matchAll(/^\s*(?:-\s*)?id:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1].trim())
  assert.deepEqual(ids, ['micromamba-env'])
})

test('the Host half declares every service it dereferences', () => {
  const match = host.match(/export const inject\s*=\s*\[([^\]]*)\]/)
  assert.ok(match, 'index.js must export a static inject list')
  const declared = match[1].split(',').map((entry) => entry.trim().replace(/['"]/g, '')).filter(Boolean)
  for (const required of ['tools', 'sessions', 'workingDirectory', 'systemPrompt']) {
    assert.ok(declared.includes(required), `inject must declare ${required}`)
  }
  // Optional services are looked up through ctx.get inside the plugin.
  assert.match(host, /optionalService\(ctx, 'sandboxPolicy'\)/)
  assert.match(host, /ctx\.inject\(\['shell'\]/)
})

test('the Host half registers the five read-only tools with output schemas', () => {
  const names = [...host.matchAll(/name:\s*'(micromamba_[a-z_]+)'/g)].map((match) => match[1])
  assert.deepEqual(names.sort(), [
    'micromamba_info',
    'micromamba_list_envs',
    'micromamba_list_packages',
    'micromamba_run',
    'micromamba_workspace_environment',
  ])
  assert.equal([...host.matchAll(/output:\s*textOutput/g)].length, 5)
})

test('the execution-policy guard listens on the pre-execute waterfall', () => {
  assert.match(host, /ctx\.on\('tools\/pre-execute'/)
  assert.match(host, /kind:\s*'deny'/)
})

test('the Client half registers through the module loader across three slots', () => {
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /exports\.inject\s*=\s*\[/)
  for (const slot of ['sidebar.panellist', 'main', 'conversation.input.left']) {
    assert.ok(client.includes(slot), `client.js must register into ${slot}`)
  }
  // The composer picker declares the session prop it reads.
  assert.match(client, /inject:\s*\(sessionId\)\s*=>\s*\(\{\s*sessionId\s*\}\)/)
})

test('both locale dictionaries exist and carry the same keys', () => {
  const english = JSON.parse(readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'))
  const chinese = JSON.parse(readFileSync(path.join(root, 'locale', 'zh.json'), 'utf8'))
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort())
})
