/**
 * HOW MANY CELLS OF A PARTITIONED SCENE LOAD AT ONCE (`createLoadSlots`), in the order the
 * partition's scheme says (`loadsBefore`, `loadOrder.ts`).
 *
 * At most `maxLoadingCells` load at once, none held back when it is 0 or less: one wished keeps
 * loading while its reads are not done — an HLOD cell's actors', the actors always loaded of a
 * level —, or while a file of an HLOD 0 cell is not placed, and the next in order starts as one
 * ends; the initial load holds none back. Each cell that starts takes a turn, and its reads ask by
 * it (`priorityOf`): files and HLOD actors alike, in that one order. The cells not started are
 * ranked again at each frame; one loading keeps its turn, its reads, asked as it started, staying
 * where they were asked.
 *
 * Cost: a frame sorts the cells waiting once, O(w log w).
 */
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { PartitionScheme } from '../../../../sdk-core/src/contracts/partitionOptions.ts'
import { cellPriority } from '../streaming/priority.ts'
import { loadsBefore, type LoadingCell } from './loadOrder.ts'

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
    /** The frame's cells `waiting` — wished, not loaded —, loading or not, sorted in place;
     *  `initial`, the initial load, holds none back. A cell no longer waiting — loaded, or wished
     *  no more — frees its slot. */
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
