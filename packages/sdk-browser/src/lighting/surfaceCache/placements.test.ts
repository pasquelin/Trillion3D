import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SURFACE_CACHE_RULES } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { createSurfaceCache } from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { createCardPlacements, type CardRoot } from './placements.ts'

const identity = (x = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]
/** A box of two metres a side, shared by every placement of a primitive. */
const BOX = Float64Array.of(-1, -1, -1, 1, 1, 1)
const root = (x: number, runtime: boolean): CardRoot => ({
  world: { elements: identity(x) },
  mesh: 0,
  runtime,
  localBox: BOX,
  worn: { surface: { version: 0, transparent: false, emissive: [0, 0, 0] } },
})
const sync = (roots: CardRoot[], runtimeCards: boolean) => {
  const cache = createSurfaceCache(resolveSettings(SURFACE_CACHE_RULES, {}))
  const placements = createCardPlacements([])
  placements.sync(cache, roots, 0, () => 1, runtimeCards)
  return { cache, placements }
}

test('the placements of a run-time primitive share the six cards made from its box', () => {
  const { cache } = sync([root(0, true), root(5, true)], true)
  assert.equal(cache.placements.size, 2)
  const [a, b] = [...cache.placements.values()]
  assert.equal(a.mesh, b.mesh)
  assert.equal(a.mesh.cards.length, 6)
  assert.equal(a.mesh.mostlyTwoSided, true)
  assert.ok(a.mesh.mesh < 0, 'a number no compiled mesh has')
})

test('two primitives cut at run time have cards of their own, though both name mesh 0', () => {
  const other = { ...root(0, true), localBox: Float64Array.of(-2, -2, -2, 2, 2, 2) }
  const { cache } = sync([root(0, true), other], true)
  const meshes = [...cache.placements.values()].map((placement) => placement.mesh.mesh)
  assert.equal(new Set(meshes).size, 2)
})

test('the setting runtimeMeshCards off leaves a run-time primitive no cards', () => {
  assert.equal(sync([root(0, true)], false).cache.placements.size, 0)
})

test('a compiled root with no cards gets none from its box', () => {
  assert.equal(sync([root(0, false)], true).cache.placements.size, 0)
})

test('a setting turned off takes the cards back, and on gives them again', () => {
  const cache = createSurfaceCache(resolveSettings(SURFACE_CACHE_RULES, {}))
  const placements = createCardPlacements([])
  const roots = [root(0, true)]
  placements.sync(cache, roots, 0, () => 1, true)
  assert.equal(cache.placements.size, 1)
  placements.sync(cache, roots, 0, () => 1, false)
  assert.equal(cache.placements.size, 0)
  placements.sync(cache, roots, 0, () => 1, true)
  assert.equal(cache.placements.size, 1)
})
