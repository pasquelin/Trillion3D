/**
 * What a grid of the partition takes (`partitionGrid`, each entry of `partitionGrids`): the names
 * of its settings, each scheme's own, and the scalar ones as rules (`settingRules.ts`), their
 * defaults the reference's. `partitionGridOptions.ts` reads a job's grids by them.
 */
import {
  DEFAULT_PARTITION_CELL_SIZE,
  DEFAULT_PARTITION_LOADING_RANGE,
  DEFAULT_PARTITION_PRIORITY,
  MAX_PARTITION_PRIORITY,
} from './compilerAbi.ts'
import { choiceSetting, flagSetting, integerSetting, positiveSetting } from './settingRules.ts'

/** The main grid's settings only the `hashSet` scheme reads: the bounds a cell of its finest
 *  level streams by, whether it lies flat on the ground, each HLOD level's grid, and the HLOD
 *  layers that have grids on it. */
export const HASH_SET_GRID_SETTINGS = ['streamBounds', 'flat', 'hlodGrids', 'hlodLayers'] as const
/** The main grid's settings only the `spatialHash` scheme reads: whether each level's cells nest
 *  in the next one's, whether a wished cell pulls in the coarser cells overlapping it, and whether
 *  an object no wider than a finest cell goes to the one under its centre. */
export const SPATIAL_HASH_GRID_SETTINGS = ['nestedLevels', 'pullCoarser', 'smallByCentre'] as const
/** The settings `partitionGrid` may name: every scheme's, then each scheme's own. */
export const PARTITION_GRID_SETTINGS = /* @__PURE__ */ (() =>
  [
    'cellSize',
    'loadingRange',
    'priority',
    'origin',
    'blockOnSlowStreaming',
    ...HASH_SET_GRID_SETTINGS,
    ...SPATIAL_HASH_GRID_SETTINGS,
  ] as const)()
/** The main grid's `blockOnSlowStreaming` when the job says nothing: the reference's, off. */
export const DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING = false
/** The bounds a cell of a loose grid's finest level streams by (`streamBounds`): the box around
 *  its content, its cell's box — of unbounded height on a flat grid —, or the first clipped to the
 *  second. A coarser level's cell streams by its content whatever it says. */
export const PARTITION_STREAM_BOUNDS = ['content', 'cell', 'clipped'] as const
/** One of `PARTITION_STREAM_BOUNDS`. */
export type PartitionStreamBounds = (typeof PARTITION_STREAM_BOUNDS)[number]
/** The main grid's stream bounds when the job names none: the reference's, its content clipped to
 *  its cell. */
export const DEFAULT_PARTITION_STREAM_BOUNDS = 'clipped' satisfies PartitionStreamBounds
/** Whether a loose grid lies flat on the ground when the job says nothing: the reference's —
 *  height neither places an object nor keeps a cell out. */
export const DEFAULT_PARTITION_FLAT = true
/** The settings one HLOD level's grid may name (`hlodGrids`), each the main grid's times
 *  `2 << level` when left out, as the reference creates them. */
export const PARTITION_HLOD_GRID_SETTINGS = ['cellSize', 'loadingRange'] as const
/** Whether a square grid's levels nest when the job says nothing: a grid the reference creates
 *  does — the cells of each level align with those of the level below; off, each level but the top
 *  is one cell wider, its edges off those of the level below. */
export const DEFAULT_PARTITION_NESTED_LEVELS = true
/** Whether a wished cell of a square grid pulls in the coarser cells overlapping it when the job
 *  says nothing: a grid the reference creates does (its levels snap to the lower ones). */
export const DEFAULT_PARTITION_PULL_COARSER = true
/** Whether an object no wider than a finest cell of a square grid goes to the one under its
 *  centre when the job says nothing: a grid the reference creates does. */
export const DEFAULT_PARTITION_SMALL_BY_CENTRE = true

/** The scalar settings of a grid, each a rule (`settingRules.ts`) the reading below asks what it
 *  takes of: `origin`, `hlodGrids` and `hlodLayers` are read by code. */
export const GRID_RULES = /* @__PURE__ */ (() => ({
  cellSize: positiveSetting('cellSize', DEFAULT_PARTITION_CELL_SIZE, 'a number of metres above 0'),
  loadingRange: positiveSetting(
    'loadingRange',
    DEFAULT_PARTITION_LOADING_RANGE,
    'a number of metres above 0',
  ),
  priority: integerSetting('priority', DEFAULT_PARTITION_PRIORITY, [0, MAX_PARTITION_PRIORITY]),
  blockOnSlowStreaming: flagSetting(
    'blockOnSlowStreaming',
    DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING,
  ),
  streamBounds: choiceSetting(
    'streamBounds',
    DEFAULT_PARTITION_STREAM_BOUNDS,
    PARTITION_STREAM_BOUNDS,
  ),
  flat: flagSetting('flat', DEFAULT_PARTITION_FLAT),
  nestedLevels: flagSetting('nestedLevels', DEFAULT_PARTITION_NESTED_LEVELS),
  pullCoarser: flagSetting('pullCoarser', DEFAULT_PARTITION_PULL_COARSER),
  smallByCentre: flagSetting('smallByCentre', DEFAULT_PARTITION_SMALL_BY_CENTRE),
}))()
