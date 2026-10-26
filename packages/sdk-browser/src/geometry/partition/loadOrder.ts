/**
 * THE ORDER THE CELLS OF A PARTITIONED SCENE LOAD IN, as the partition's scheme says
 * (`TablePartition.scheme`).
 *
 * The cells wished and not loaded load in one order (`loadsBefore`). On loose grids: the higher
 * level on its grid first, then the lower grid priority — the main grid's, the job's, 0 by
 * default; an HLOD grid's 0 —, then the lower distance ratio — the squared 3D distance from the
 * eye to its box over the squared radius, at most 1, times half the cosine of the view's axis with
 * the way from the box to the eye plus a half, -1 from within it (`StreamingSource.ranked`) —;
 * `sortByExtent`, `sortByPriority` and `angleWeight` rank nothing there. On square grids: the wider
 * first — a cell's half side, or its level on its grid (`sortByExtent`) —, then the lower grid
 * priority — the main grid's 0, an HLOD grid's 100 plus its level (`sortByPriority`) —, then the
 * nearer: the square of the distance from the eye to the cell's centre, times the square of the
 * angle the view turns to reach it, that angle raised to `angleWeight`. Cells still tied load by
 * their keys, the lower first. A cell always loaded — one no view reaches (`LoadingCell.always`) —
 * ranks after every other, on either kind of grid.
 */
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { PartitionScheme } from '../../../../sdk-core/src/contracts/partitionOptions.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { NEARLY_ZERO_SQUARED_LENGTH } from './sourceShape.ts'

/** How far apart two loose cells' distance ratios must lie for one to load first: the reference's
 *  tolerance on that ratio, which has no unit. */
const RATIO_TOLERANCE = 1e-8

/** A cell waiting to load, as the order ranks it: its key, the half side of the bounds it streams
 *  by — a square cell's half side — and the level of its cell on its grid, its grid's priority,
 *  and its distance as `StreamingSource.ranked` gives it; `always` for a cell always loaded, which
 *  no view reaches: it ranks after the cells a view reaches and takes no room of its own while it
 *  starts. */
export type LoadingCell = {
  key: number
  extent: number
  level: number
  priority: number
  distance: number
  raw: number
  always?: boolean
}

/** The order of `a` and `b` by `always` alone: one always loaded after one a view reaches, 0 when
 *  both or neither are. */
const alwaysLast = (a: LoadingCell, b: LoadingCell) => Number(!!a.always) - Number(!!b.always)

/** Whether `a` loads before `b` on loose grids: a cell a view reaches first, then the higher
 *  level, then the lower grid priority, then the lower distance ratio — two within
 *  `RATIO_TOLERANCE` tie, the lower key first, so that the order never depends on the order the
 *  cells were listed in. */
function looseBefore(a: LoadingCell, b: LoadingCell) {
  const last = alwaysLast(a, b)
  if (last !== 0) return last
  if (a.level !== b.level) return b.level - a.level
  if (a.priority !== b.priority) return a.priority - b.priority
  const nearer = a.distance - b.distance
  return Math.abs(nearer) <= RATIO_TOLERANCE ? a.key - b.key : nearer
}

/** Whether `a` loads before `b` on square grids under `streaming`'s order: a cell a view reaches
 *  first, then the wider, or the higher level; then the lower grid priority unless it ranks after
 *  the distance; then the nearer, the raw distance breaking a tie, the lower key a last one. */
function squareBefore(streaming: WorldStreaming, a: LoadingCell, b: LoadingCell) {
  const last = alwaysLast(a, b)
  if (last !== 0) return last
  const wider = streaming.sortByExtent
    ? Math.trunc((b.extent - a.extent) * CENTIMETRES_PER_METRE)
    : b.level - a.level
  if (wider !== 0) return wider
  if (streaming.sortByPriority && a.priority !== b.priority) return a.priority - b.priority
  const nearer = a.distance - b.distance
  const order = Math.abs(nearer) <= NEARLY_ZERO_SQUARED_LENGTH ? a.raw - b.raw : nearer
  if (order !== 0) return order
  if (!streaming.sortByPriority && a.priority !== b.priority) return a.priority - b.priority
  return a.key - b.key
}

/** The load order of a partition of `scheme` under `streaming` as it stands at each comparison:
 *  negative when `a` loads before `b`. */
export const loadsBefore = (streaming: WorldStreaming, scheme: PartitionScheme) =>
  scheme === 'hashSet'
    ? looseBefore
    : (a: LoadingCell, b: LoadingCell) => squareBefore(streaming, a, b)
