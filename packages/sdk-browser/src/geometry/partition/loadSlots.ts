/**
 * THE ORDER THE CELLS OF A PARTITIONED SCENE LOAD IN, as the partition's scheme says
 * (`TablePartition.scheme`), and how many load at once (`createLoadSlots`).
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
 * ranks after every other, on either kind of grid. At most `maxLoadingCells` load at once, none
 * held back when it is 0 or less (`createLoadSlots`): one wished keeps loading until its content is
 * whole, and the next in order starts as one ends; the initial load holds none back. Each cell
 * that starts takes a turn, and its reads ask by it (`priorityOf`): files and HLOD actors alike,
 * in that one order. The cells not started are ranked again at each frame; one loading keeps its
 * turn, its reads, asked as it started, staying where they were asked.
 *
 * Cost: a frame sorts the cells waiting once, O(w log w).
 */
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { PartitionScheme } from '../../../../sdk-core/src/contracts/partitionOptions.ts'
import { cellPriority } from '../streaming/priority.ts'

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

/** Whether `a` loads before `b` on loose grids: a cell a view reaches first, then the higher
 *  level, then the lower grid priority, then the lower distance ratio — two within
 *  `RATIO_TOLERANCE` tie, the lower key first, so that the order never depends on the order the
 *  cells were listed in. */
function looseBefore(a: LoadingCell, b: LoadingCell) {
  if (!a.always !== !b.always) return a.always ? 1 : -1
  if (a.level !== b.level) return b.level - a.level
  if (a.priority !== b.priority) return a.priority - b.priority
  const nearer = a.distance - b.distance
  return Math.abs(nearer) <= RATIO_TOLERANCE ? a.key - b.key : nearer
}

/** Whether `a` loads before `b` on square grids under `streaming`'s order: a cell a view reaches
 *  first, then the wider, or the higher level; then the lower grid priority unless it ranks after
 *  the distance; then the nearer, the raw distance breaking a tie, the lower key a last one. */
function squareBefore(streaming: WorldStreaming, a: LoadingCell, b: LoadingCell) {
  if (!a.always !== !b.always) return a.always ? 1 : -1
  const wider = streaming.sortByExtent ? Math.trunc((b.extent - a.extent) * 100) : b.level - a.level
  if (wider !== 0) return wider
  if (streaming.sortByPriority && a.priority !== b.priority) return a.priority - b.priority
  const nearer = a.distance - b.distance
  const order = Math.abs(nearer) <= 1e-12 ? a.raw - b.raw : nearer
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

/**
 * The cells loading at once under `streaming` for a partition of `scheme`: each frame (`admit`),
 * of the cells wished and not loaded, those loading go on, and the next in load order
 * (`loadsBefore`) start while room is left — `maxLoadingCells` less the cells loading, none held
 * back during the initial load nor when `maxLoadingCells` is 0 or less. A cell always loaded
 * starts only while room is left, and takes none. A cell left without a slot is `queued`: the
 * frame asks to be run again. The cells loading are kept in the order they started (`loading`),
 * each with the turn it took (`priorityOf`): the reads of each are asked by it, the queue serving
 * them in that order.
 */
export function createLoadSlots(streaming: WorldStreaming, scheme: PartitionScheme) {
  /** The cells loading, each with its turn, and the turn the next to start takes. */
  const loading = new Map<number, number>(),
    wished = new Set<number>()
  let turns = 0
  const order = loadsBefore(streaming, scheme)
  return {
    /** The frame's cells `waiting` — wished, not loaded —, loading or not; `initial`, the initial
     *  load, holds none back. A cell no longer waiting — loaded, or wished no more — frees its
     *  slot. */
    admit(waiting: LoadingCell[], initial: boolean) {
      wished.clear()
      for (const cell of waiting) wished.add(cell.key)
      for (const key of loading.keys()) if (!wished.has(key)) loading.delete(key)
      // The turns count from none again once nothing loads: the reads asked by one are done.
      if (!loading.size) turns = 0
      const limit = initial || streaming.maxLoadingCells <= 0 ? Infinity : streaming.maxLoadingCells
      let room = limit - loading.size
      if (room <= 0) return
      waiting.sort(order)
      for (const cell of waiting) {
        if (room <= 0) break
        if (loading.has(cell.key)) continue
        loading.set(cell.key, turns++)
        if (!cell.always) room--
      }
    },
    /** Whether `key` loads now: its content is read. */
    loads: (key: number) => loading.has(key),
    /** The keys loading now, in the order they started: the load order of those started in one
     *  frame, those of an earlier frame first. */
    loading: (): Iterable<number> => loading.keys(),
    /** The priority the reads of `key` ask by (`cellPriority`): that of the turn the cell took as
     *  it started; a read of no cell loading comes after the reads of every cell loading. */
    priorityOf: (key?: number) =>
      cellPriority((key === undefined ? undefined : loading.get(key)) ?? turns),
    /** Whether a cell wished and not loaded holds no slot yet: it waits for a frame at which one
     *  ends, which a still view must be drawn for. */
    queued: () => wished.size > loading.size,
    /** Every cell let go. */
    clear() {
      loading.clear()
      turns = 0
    },
  }
}

export type LoadSlots = ReturnType<typeof createLoadSlots>
