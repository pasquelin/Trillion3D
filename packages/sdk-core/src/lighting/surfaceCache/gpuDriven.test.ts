// The update of the scene decided by the GPU (`gpuDriven.ts`): the record of a placement, the lists applied under the CPU's limits, and the setting off by default.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../contracts/surfaceCacheOptions.ts'
import { resolveSettingsInto, type SettingValues } from '../../contracts/settingRules.ts'
import { cardLimits } from './cardResolution.ts'
import type { MeshCards } from './cardTypes.ts'
import {
  applySceneOps,
  GROUP_FLAGS,
  GROUP_WORDS,
  NO_MESH_CARDS_WORD,
  writeGroupWords,
} from './gpuDriven.ts'
import { createSurfaceCache, type Placement } from './state.ts'
import { updateSurfaceCache } from './update.ts'

const defaults = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, defaults)

const placement = (id: number, meshCards = -1): Placement => ({
  id,
  world: new Float64Array(16),
  mesh: {
    cards: [],
    min: [0, 0, 0],
    max: [0, 0, 0],
    mostlyTwoSided: false,
  } as unknown as MeshCards,
  shareId: -1,
  emissive: true,
  opaqueOrMasked: false,
  lightingChannels: 1,
  bounds: new Float64Array([-10, 0, 20, 30, 0, 60]),
  extentMax: 20,
  visible: false,
  validMeshCards: true,
  meshCards,
})

const view = {
  origins: [[0, 0, 0]] as [number, number, number][],
  orthographic: false,
  clipmapExtent: 100000,
  addTranslucent: true,
}
const limits = cardLimits(defaults, false, view.clipmapExtent)

const bits = (value: number) => new Uint32Array(Float32Array.of(value).buffer)[0]!

test('the GPU update is off by default, as the reference', () => {
  assert.equal(defaults.surfaceCacheGpuDrivenUpdate, false)
})

test('a placement is a record of the centre and half sides of its box, its mesh cards and its flags; a removed one is zeros', () => {
  const u32 = new Uint32Array(2 * GROUP_WORDS)
  const f32 = new Float32Array(u32.buffer)
  writeGroupWords(f32, u32, GROUP_WORDS, placement(1))
  assert.deepEqual(Array.from(f32.slice(GROUP_WORDS, GROUP_WORDS + 3)), [10, 0, 40])
  assert.deepEqual(Array.from(f32.slice(GROUP_WORDS + 4, GROUP_WORDS + 7)), [20, 0, 20])
  assert.equal(u32[GROUP_WORDS + 3], NO_MESH_CARDS_WORD)
  assert.equal(
    u32[GROUP_WORDS + 7],
    GROUP_FLAGS.placed | GROUP_FLAGS.validMeshCards | GROUP_FLAGS.emissive,
  )
  writeGroupWords(f32, u32, GROUP_WORDS, undefined)
  assert.ok(u32.slice(GROUP_WORDS).every((word) => word === 0))
  // A flat box is still a placement: the flag says so, not the extent.
  writeGroupWords(f32, u32, 0, placement(0, 5))
  assert.equal(u32[3], 5)
  assert.ok((u32[7]! & GROUP_FLAGS.placed) !== 0)
})

test('the lists read back are applied: the adds that still want cards are counted with their ids, the others skipped', () => {
  const cache = createSurfaceCache({ ...defaults, surfaceCacheGpuDrivenUpdate: true })
  cache.placements.set(0, placement(0))
  cache.placements.set(1, { ...placement(1), validMeshCards: false })
  // Three adds: the placement 0, the placement 1 (cannot have cards), the placement 7 (gone).
  const add = new Uint32Array([3, 0, 0, 0, bits(25), 1, bits(4), 7, bits(1)])
  const remove = new Uint32Array([1, 0])
  applySceneOps(cache, { add, remove }, view, limits)
  assert.equal(cache.stats.meshCardsToAdd, 1)
  assert.deepEqual(Array.from(cache.stats.addOps.slice(0, 2)), [1, 0])
  assert.deepEqual(Array.from(cache.stats.removeOps.slice(0, 2)), [1, 0])
})

test('with the setting on the update applies the lists and leaves the CPU test alone', () => {
  const settings = { ...defaults, surfaceCacheGpuDrivenUpdate: true }
  const cache = createSurfaceCache(settings)
  cache.placements.set(0, { ...placement(0), opaqueOrMasked: true })
  const view = {
    origins: [[0, 0, 0]] as [number, number, number][],
    orthographic: false,
    clipmapExtent: 100000,
  }
  updateSurfaceCache(cache, settings, view)
  assert.equal(cache.stats.meshCardsToAdd, 0)
  updateSurfaceCache(cache, settings, {
    ...view,
    sceneOps: { add: new Uint32Array([1, 0, 0, bits(9)]), remove: new Uint32Array([0]) },
  })
  assert.equal(cache.stats.meshCardsToAdd, 1)
})

test('a remove of a placement that wants its cards again is skipped', () => {
  const cache = createSurfaceCache({ ...defaults, surfaceCacheGpuDrivenUpdate: true })
  const near = { ...placement(0, 3), visible: true, opaqueOrMasked: true }
  cache.placements.set(0, near)
  applySceneOps(cache, { add: new Uint32Array([0]), remove: new Uint32Array([1, 0]) }, view, limits)
  assert.equal(near.meshCards, 3)
  assert.equal(near.visible, true)
})

test('the counts of the lists stay in the debug table between two lists', () => {
  const settings = { ...defaults, surfaceCacheGpuDrivenUpdate: true }
  const cache = createSurfaceCache(settings)
  cache.placements.set(0, placement(0))
  applySceneOps(
    cache,
    { add: new Uint32Array([1, 0, 0, bits(9)]), remove: new Uint32Array([0]) },
    view,
    limits,
  )
  updateSurfaceCache(cache, settings, view)
  assert.equal(cache.stats.addOps[0], 1)
})
