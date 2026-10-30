import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SURFACE_CACHE_RULES } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { DIAGNOSTICS } from '../../../../../sdk-core/src/runtime/diagnostics.ts'
import { CONTEXT_ARGS, CONTEXT_AT } from '../lighting/layout.ts'
import {
  CONTEXT_HEADER_READ_WORDS,
  lightingStatsLines,
  sceneDebugOf,
  sceneDebugShown,
  sceneStatsLines,
} from './views.ts'

const settings = (extra: Record<string, number | boolean> = {}) =>
  resolveSettings(SURFACE_CACHE_RULES, extra)

test('no view is shown by default, whatever the mode, and the modes of the views are registered', () => {
  assert.equal(sceneDebugShown(sceneDebugOf(settings(), 'beauty')), false)
  for (const mode of [
    'surface-cache-direct-stats',
    'surface-cache-indirect-stats',
    'surface-cache-direct-lighting-stats',
    'surface-cache-scene-stats',
    'surface-cache-primitive-groups',
  ] as const) {
    assert.equal(DIAGNOSTICS[mode].available, true)
    assert.equal(sceneDebugShown(sceneDebugOf(settings(), mode)), true)
  }
})

test('a setting or a mode picks the view; the mode of an update overrides the setting’s number', () => {
  assert.equal(sceneDebugOf(settings({ surfaceCacheLightingStats: 2 }), 'beauty').lightingStats, 2)
  assert.equal(
    sceneDebugOf(settings({ surfaceCacheLightingStats: 2 }), 'surface-cache-direct-stats')
      .lightingStats,
    1,
  )
  assert.equal(sceneDebugOf(settings(), 'surface-cache-indirect-stats').lightingStats, 2)
  assert.equal(sceneDebugOf(settings({ surfaceCacheSceneStats: true }), 'beauty').sceneStats, true)
  assert.equal(sceneDebugOf(settings(), 'surface-cache-scene-stats').sceneStats, true)
  assert.equal(
    sceneDebugOf(settings({ surfaceCacheVisualizePrimitiveGroups: true }), 'beauty')
      .primitiveGroups,
    true,
  )
  assert.equal(sceneDebugOf(settings(), 'surface-cache-primitive-groups').primitiveGroups, true)
})

test('the table of an update reads its own histogram, bucket, pages and tiles', () => {
  const words = new Uint32Array(CONTEXT_HEADER_READ_WORDS)
  for (let k = 0; k < 32; k++) words[CONTEXT_AT.histogram + k] = k + 1
  words.set([7, 70, 8, 80], CONTEXT_AT.maxBucket)
  words.set([100, 0, 200, 0], CONTEXT_AT.allocated)
  words.set([3, 4], CONTEXT_AT.pagesListed)
  assert.deepEqual(lightingStatsLines(words, 0), [
    '',
    '1 2 3 4 5 6 7 8',
    '9 10 11 12 13 14 15 16',
    '',
    'MaxBucket 7',
    'MaxTilesFromMaxBucket 70',
    'Out',
    ' Pages 3',
    ' Tiles 100',
  ])
  const indirect = lightingStatsLines(words, 1)
  assert.equal(indirect[1], '17 18 19 20 21 22 23 24')
  assert.deepEqual(indirect.slice(4), [
    'MaxBucket 8',
    'MaxTilesFromMaxBucket 80',
    'Out',
    ' Pages 4',
    ' Tiles 200',
  ])
})

test('the scene table writes the three counts and the scene operations', () => {
  const addOps = new Uint32Array([2, 7, 9, 0])
  assert.deepEqual(
    sceneStatsLines({
      placements: 5,
      meshCards: 4,
      cards: 21,
      addOps,
      removeOps: new Uint32Array([0, 0]),
    }),
    ['NumPrimitiveGroups 5', 'NumMeshCards 4', 'NumCards 21', 'AddOps    2 7 9 0', 'RemoveOps 0 0'],
  )
})

test('the direct lighting table writes the trace groups and the cards and tiles lit from the header', async () => {
  const { directLightingStatsLines } = await import('./directLightingStats.ts')
  const words = new Uint32Array(CONTEXT_HEADER_READ_WORDS)
  words[CONTEXT_AT.pagesListed] = 7
  words[CONTEXT_AT.allocated] = 90
  words[CONTEXT_AT.args + 4 * CONTEXT_ARGS.shadowTraces] = 3
  const counts = {
    lights: 5,
    batched: 2,
    standalone: 1,
    rect: true,
    lightFunctions: false,
    ies: false,
  }
  const lines = directLightingStatsLines(
    counts,
    4096,
    settings({ surfaceCacheDirectLightingHardwareRayTracing: false }),
    words,
  )
  assert.ok(lines.includes('RT Traces  : 192'))
  assert.ok(lines.includes('Updating Card  : 7'))
  assert.ok(lines.includes('Updating Tiles : 90'))
  assert.ok(lines.includes('Rect lights      : true'))
  assert.ok(lines.includes('Method     : Software'))
  assert.equal(sceneDebugOf(settings({ surfaceCacheLightingStats: 3 }), 'beauty').lightingStats, 3)
  assert.equal(CONTEXT_HEADER_READ_WORDS, CONTEXT_AT.args + 4 * CONTEXT_ARGS.shadowTraces + 1)
})

test('the cards, the tiles and the card under the cursor are views of their own settings', () => {
  assert.equal(
    sceneDebugShown(sceneDebugOf(settings({ surfaceCacheViewCards: true }), 'beauty')),
    true,
  )
  assert.equal(
    sceneDebugShown(sceneDebugOf(settings({ surfaceCacheViewTiles: true }), 'beauty')),
    true,
  )
  const cursor = sceneDebugOf(
    settings({ surfaceCacheCursorCard: true, surfaceCacheCursorCardLayer: 4 }),
    'beauty',
  )
  assert.deepEqual([cursor.cursorCard, cursor.cursorCardLayer], [true, 4])
})

test('the radiosity probes are a view of their own settings, with the radius and the invalid probes', () => {
  const off = sceneDebugOf(settings({}), 'beauty')
  assert.deepEqual(
    [off.radiosityProbes, off.radiosityProbeRadius, off.radiosityProbesShowInvalid],
    [false, 10, false],
  )
  const view = sceneDebugOf(
    settings({
      surfaceCacheRadiosityVisualizeProbes: true,
      surfaceCacheRadiosityVisualizeProbeRadius: 5,
      surfaceCacheRadiosityVisualizeProbesShowInvalid: true,
    }),
    'beauty',
  )
  assert.deepEqual(
    [view.radiosityProbes, view.radiosityProbeRadius, view.radiosityProbesShowInvalid],
    [true, 5, true],
  )
  assert.equal(sceneDebugShown(view), true)
})
