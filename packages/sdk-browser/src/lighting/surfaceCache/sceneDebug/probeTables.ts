import type { ScreenProbeValues } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { DiagnosticMode } from '../../../../../sdk-core/src/runtime/diagnostics.ts'
import type { PoolStats } from '../../bounce/pool/pool.ts'
import {
  INTEGRATE_TILE_COUNTS_AT,
  INTEGRATE_TILE_MODE_COUNT,
} from '../../bounce/screen/screenProbeLayout.ts'

/**
 * THE PROBES' DEBUG TABLES over the display image, and how a view picks one: a setting (`screenProbeRadianceCacheStats`, `screenProbeGatherDebug`, `screenProbeTileDebugMode`) or a
 * diagnostic mode. The words of the tables from the counters the passes already keep (the pool's statistics, the placement's count of adaptive probes, the integration's counts of tiles),
 * no GPU.
 */

/** The settings a probe debug view reads. */
export type ProbeDebugValues = Pick<
  ScreenProbeValues,
  | 'screenProbeRadianceCacheStats'
  | 'screenProbeGatherDebug'
  | 'screenProbeTileDebugMode'
  | 'screenProbeGatherDebugProbePlacement'
>

/** What the image shows of the probes: the world's probes update statistics, the count of screen probes, the tiles of the integration by mode, where the screen probes stand (0 nowhere, 1 all, 2 the adaptive ones, 3 their points and normals). */
export interface ProbeDebug {
  radianceCacheStats: boolean
  gatherCounters: boolean
  tileStats: boolean
  placement: 0 | 1 | 2 | 3
}

/** The views to show: each the setting names or the diagnostic mode `mode` names. */
export const probeDebugOf = (values: ProbeDebugValues, mode: DiagnosticMode): ProbeDebug => ({
  radianceCacheStats: values.screenProbeRadianceCacheStats || mode === 'radiance-cache-stats',
  gatherCounters: values.screenProbeGatherDebug || mode === 'screen-probe-gather-debug',
  tileStats: values.screenProbeTileDebugMode || mode === 'screen-probe-tile-stats',
  placement:
    mode === 'screen-probe-placement'
      ? 1
      : (values.screenProbeGatherDebugProbePlacement as ProbeDebug['placement']),
})

/** Whether any probe view is shown. */
export const probeDebugShown = (view: ProbeDebug) =>
  view.radianceCacheStats || view.gatherCounters || view.tileStats || view.placement > 0

/** The words the probes' readback holds: the count of adaptive probes, then the integration's tile buffer from the arguments of each mode to its counts. */
export const PROBE_COUNTER_WORDS = 1 + INTEGRATE_TILE_COUNTS_AT + INTEGRATE_TILE_MODE_COUNT

/** The lines of the world's probes table: the probes the atlas holds out of the `capacity` it has, those that hold nothing yet, those not traced since the lights last changed, the marks refused for want of a probe, the probes the last pass queued and the cells it marked. */
export const radianceCacheStatsLines = (stats: PoolStats, capacity: number) => [
  '',
  `MaxProbesInAtlas ${capacity}`,
  `ProbesInAtlas ${stats.live}`,
  `Unfilled ${stats.unfilled}`,
  `Refreshing ${stats.refreshing}`,
  `Refused ${stats.refused}`,
  `Traced Probes ${stats.queued}`,
  `Marked ${stats.marked}`,
]

/** The lines of the screen probes count: the `uniform` probes and the `adaptive` ones. */
export const screenProbeCounterLines = (uniform: number, adaptive: number) => [
  `NumScreenProbes:         ${uniform + adaptive}`,
  `NumUniformScreenProbes:  ${uniform}`,
  `NumAdaptiveScreenProbes: ${adaptive}`,
]

/** The modes of the integration's tiles, in the order of their counts, as the table names them. */
export const TILE_MODE_NAMES = ['Simple', 'ImportanceSample', 'All'] as const

/** The width the names of the table are padded to. */
const NAME_WIDTH = 17

/** The lines of the integration's tile table: the tiles along and across, the layers (the engine has one) and the extra tiles (none), then the tiles of each mode and their `total`, from the counts
 *  `words` of the readback (`PROBE_COUNTER_WORDS`) for an image of `tiles` tiles along and across. */
export function tileStatsLines(tiles: readonly [number, number], words: ArrayLike<number>) {
  const counts = TILE_MODE_NAMES.map((_, mode) => words[1 + INTEGRATE_TILE_COUNTS_AT + mode]!)
  return [
    'Screen Probe',
    `Tile  Count      : ${tiles[0]} x ${tiles[1]}`,
    'Layer Count      : 1',
    'Extra tile Count : 0',
    '',
    'Primary',
    ...TILE_MODE_NAMES.map((name, mode) => `${name.padEnd(NAME_WIDTH)}: ${counts[mode]}`),
    `${'Total'.padEnd(NAME_WIDTH)}: ${counts.reduce((sum, count) => sum + count, 0)}`,
  ]
}
