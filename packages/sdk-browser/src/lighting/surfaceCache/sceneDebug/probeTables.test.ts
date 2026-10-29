import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROBE_COUNTER_WORDS,
  probeDebugOf,
  probeDebugShown,
  radianceCacheStatsLines,
  screenProbeCounterLines,
  tileStatsLines,
} from './probeTables.ts'
import { DIAGNOSTICS } from '../../../../../sdk-core/src/runtime/diagnostics.ts'
import { INTEGRATE_TILE_COUNTS_AT } from '../../bounce/screen/screenProbeLayout.ts'

const values = (changes: Partial<Parameters<typeof probeDebugOf>[0]> = {}) => ({
  screenProbeRadianceCacheStats: false,
  screenProbeGatherDebug: false,
  screenProbeTileDebugMode: false,
  screenProbeGatherDebugProbePlacement: 0 as number,
  screenProbeGatherVisualizeTraces: false,
  screenProbeGatherVisualizeTracesFreeze: false,
  visualizeUseShaderPrintForTraces: true,
  visualizeToneMap: true,
  reflectionVisualizeTraces: false,
  radianceCacheVisualize: 0,
  radianceCacheVisualizeRadiusScale: 1,
  radianceCacheVisualizeClipmapIndex: -1,
  visualizeSceneTraceRadianceCache: false,
  visualizeHiResSurface: true,
  visualizeMinTraceDistance: 0,
  visualizeMaxTraceDistance: 100000,
  debugCursorX: -1,
  debugCursorY: -1,
  ...changes,
})

test('a probe view shows when its setting is on or its mode is chosen, and none otherwise', () => {
  assert.equal(probeDebugShown(probeDebugOf(values(), 'beauty')), false)
  assert.deepEqual(probeDebugOf(values({ screenProbeGatherDebug: true }), 'beauty'), {
    radianceCacheStats: false,
    gatherCounters: true,
    tileStats: false,
    placement: 0,
    traces: false,
    tracesFrozen: false,
    tracesDepthTested: false,
    tracesTonemapped: true,
    reflectionTraces: false,
    radianceProbes: 0,
    radianceProbeRadius: 0.05,
    radianceProbeLevel: -1,
    sceneVisualization: false,
    sceneTraceRadianceCache: false,
    sceneHiRes: true,
    sceneMinTrace: 0,
    sceneMaxTrace: 100000,
    sceneToneMap: true,
    cursor: [-1, -1],
  })
  assert.equal(probeDebugOf(values(), 'radiance-cache-stats').radianceCacheStats, true)
  assert.equal(probeDebugOf(values(), 'screen-probe-traces').traces, true)
  assert.equal(probeDebugOf(values(), 'reflection-traces').reflectionTraces, true)
  assert.equal(probeDebugOf(values(), 'radiance-cache-probes').radianceProbes, 1)
  assert.equal(probeDebugOf(values({ radianceCacheVisualize: 2 }), 'beauty').radianceProbes, 2)
  assert.equal(probeDebugShown(probeDebugOf(values(), 'scene-visualization')), true)
  assert.equal(
    probeDebugOf(values({ screenProbeGatherVisualizeTraces: true }), 'beauty').traces,
    true,
  )
  assert.equal(probeDebugOf(values(), 'screen-probe-gather-debug').gatherCounters, true)
  assert.equal(probeDebugOf(values(), 'screen-probe-tile-stats').tileStats, true)
  assert.equal(probeDebugOf(values(), 'screen-probe-placement').placement, 1)
  assert.equal(
    probeDebugOf(values({ screenProbeGatherDebugProbePlacement: 3 }), 'beauty').placement,
    3,
  )
  for (const mode of [
    'radiance-cache-stats',
    'screen-probe-gather-debug',
    'screen-probe-tile-stats',
    'screen-probe-placement',
    'screen-probe-traces',
  ] as const)
    assert.equal(DIAGNOSTICS[mode].available, true)
})

test('the world’s probes table writes the statistics the pool counted', () => {
  const stats = {
    reads: 3,
    live: 40,
    unfilled: 2,
    refreshing: 5,
    refused: 1,
    queued: 7,
    marked: 90,
  }
  assert.deepEqual(radianceCacheStatsLines(stats, 512), [
    '',
    'MaxProbesInAtlas 512',
    'ProbesInAtlas 40',
    'Unfilled 2',
    'Refreshing 5',
    'Refused 1',
    'Traced Probes 7',
    'Marked 90',
  ])
})

test('the screen probes count adds the uniform and the adaptive probes', () => {
  assert.deepEqual(screenProbeCounterLines(100, 25), [
    'NumScreenProbes:         125',
    'NumUniformScreenProbes:  100',
    'NumAdaptiveScreenProbes: 25',
  ])
})

test('the tile table writes the tiles of each mode from the counts after the arguments, and their total', () => {
  const words = new Uint32Array(PROBE_COUNTER_WORDS)
  words.set([10, 20, 30], 1 + INTEGRATE_TILE_COUNTS_AT)
  assert.deepEqual(tileStatsLines([175, 99], words), [
    'Screen Probe',
    'Tile  Count      : 175 x 99',
    'Layer Count      : 1',
    'Extra tile Count : 0',
    '',
    'Primary',
    'Simple           : 10',
    'ImportanceSample : 20',
    'All              : 30',
    'Total            : 60',
  ])
})

test('the traces are drawn against the depth where the shader print path is off, and tone mapped through the table unless the setting says otherwise', () => {
  const printed = probeDebugOf(values({ visualizeToneMap: false }), 'beauty')
  assert.equal(printed.tracesDepthTested, false)
  assert.equal(printed.tracesTonemapped, false)
  const triangles = probeDebugOf(
    values({ visualizeUseShaderPrintForTraces: false, visualizeToneMap: false }),
    'beauty',
  )
  assert.equal(triangles.tracesDepthTested, true)
  assert.equal(triangles.tracesTonemapped, true)
})
