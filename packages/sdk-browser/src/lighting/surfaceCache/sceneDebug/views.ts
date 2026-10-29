import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { PRIORITY_HISTOGRAM_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import type { DiagnosticMode } from '../../../../../sdk-core/src/runtime/diagnostics.ts'
import { CONTEXT_ARGS, CONTEXT_AT } from '../lighting/layout.ts'

/**
 * THE SURFACE CACHE'S DEBUG TABLES AND BOXES over the display image, and how a view picks one: a setting (`surfaceCacheLightingStats`, `surfaceCacheSceneStats`,
 * `surfaceCacheVisualizePrimitiveGroups`) or a diagnostic mode. Pure choices and the words of the tables, no GPU.
 */

/** The settings a debug view reads. */
export type SceneDebugSettings = Pick<
  SurfaceCacheSettings,
  'surfaceCacheLightingStats' | 'surfaceCacheSceneStats' | 'surfaceCacheVisualizePrimitiveGroups'
>

/** What the image shows of the cache: the update whose table is written (0 none, 1 the direct light's, 2 the indirect's, 3 the lights and atlas of the direct light's), the counts of the scene, the boxes of the placements. */
export interface SceneDebug {
  lightingStats: 0 | 1 | 2 | 3
  sceneStats: boolean
  primitiveGroups: boolean
}

const LIGHTING_STATS = [0, 1, 2, 3] as const

const MODE_STATS: Partial<Record<DiagnosticMode, 1 | 2 | 3>> = {
  'surface-cache-direct-stats': 1,
  'surface-cache-indirect-stats': 2,
  'surface-cache-direct-lighting-stats': 3,
}

/** The views to show: each the setting names or the diagnostic mode `mode` names. */
export const sceneDebugOf = (settings: SceneDebugSettings, mode: DiagnosticMode): SceneDebug => ({
  lightingStats: MODE_STATS[mode] ?? LIGHTING_STATS[settings.surfaceCacheLightingStats] ?? 0,
  sceneStats: settings.surfaceCacheSceneStats || mode === 'surface-cache-scene-stats',
  primitiveGroups:
    settings.surfaceCacheVisualizePrimitiveGroups || mode === 'surface-cache-primitive-groups',
})

/** Whether any view is shown. */
export const sceneDebugShown = (view: SceneDebug) =>
  view.lightingStats > 0 || view.sceneStats || view.primitiveGroups

/** The words of the context buffer's header the tables read: everything before the dispatch arguments, then the groups of shadow traces. */
export const CONTEXT_HEADER_READ_WORDS = CONTEXT_AT.args + 4 * CONTEXT_ARGS.shadowTraces + 1

/** The buckets a row of the histogram holds. */
const ROW = 8

/** The lines of the table of update `context` (0 the direct light's, 1 the indirect's) from the header `words` of the context buffer: the tiles of each priority bucket, eight a line, the bucket the budget ends in and its tiles, the pages and the tiles the image lights. */
export function lightingStatsLines(words: ArrayLike<number>, context: 0 | 1): string[] {
  const lines = ['']
  const first = CONTEXT_AT.histogram + context * PRIORITY_HISTOGRAM_SIZE
  for (let at = 0; at < PRIORITY_HISTOGRAM_SIZE; at += ROW)
    lines.push(Array.from({ length: ROW }, (_, k) => words[first + at + k]!).join(' '))
  lines.push(
    '',
    `MaxBucket ${words[CONTEXT_AT.maxBucket + context * 2]}`,
    `MaxTilesFromMaxBucket ${words[CONTEXT_AT.maxBucket + context * 2 + 1]}`,
    'Out',
    ` Pages ${words[CONTEXT_AT.pagesListed + context]}`,
    // The tiles given out: two words an update, the first alone counts.
    ` Tiles ${words[CONTEXT_AT.allocated + context * 2]}`,
  )
  return lines
}

/** The counts the scene table writes. */
export interface SceneCounts {
  placements: number
  meshCards: number
  cards: number
  /** The scene operations of the image: the count, then the ids of the first ones. */
  addOps: ArrayLike<number>
  removeOps: ArrayLike<number>
}

/** The lines of the scene table. */
export const sceneStatsLines = (counts: SceneCounts) => [
  `NumPrimitiveGroups ${counts.placements}`,
  `NumMeshCards ${counts.meshCards}`,
  `NumCards ${counts.cards}`,
  `AddOps    ${Array.from(counts.addOps).join(' ')}`,
  `RemoveOps ${Array.from(counts.removeOps).join(' ')}`,
]
