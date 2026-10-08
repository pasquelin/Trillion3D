// The scale laws' world has one source: the page that builds it at run time reads the module the
// cooked scene is made from, the bench mapping its import, and holds no copy of its own.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pageModules, readPage } from '../page.ts'
import { lawWorld } from './world.ts'
import { scatter } from './scatter.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

test('the runtime page builds the laws’ world module, every import it names mapped by the bench', () => {
  const code = readPage(fileURLToPath(new URL('./world.html', import.meta.url))).scripts.join('\n')
  const modules = pageModules(ROOT, 'engine')
  const relative = [...code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((found) => found[1])
  assert.deepEqual(
    relative.filter((path) => !(path in modules)),
    [],
  )
  assert.ok(relative.includes('./world.js'), 'the world module read')
  assert.ok(existsSync(fileURLToPath(modules['./world.js'])))
  // No seeded sequence and no tower of its own: the world is the module's.
  assert.doesNotMatch(code, /1664525|geometry\.cylinder/)
})

test('the world holds the ground and one mesh a kind, at the scattered places', () => {
  const { meshes, placed } = lawWorld(1001)
  assert.deepEqual(
    meshes.map(({ name }) => name),
    ['ground', 'pebble', 'rock', 'tower'],
  )
  assert.deepEqual(placed, scatter(1001))
})
