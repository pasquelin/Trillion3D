/**
 * The world bundles past the pinned top the held cells need (`cells[].objects[].dependencies`):
 * each read once however many cells share it, and let go when the last leaves. Who must follow
 * them watches each bundle as the cells start or stop holding it: the roots one cell alone needs
 * they carry (`top.rs`) are kept resident by the cut's cache while held
 * (`../webgpu/pages/prepare/worldRoot.ts`).
 */
import {
  cellDependencies,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'

/** A held bundle: how many held cells hold it, and its read. */
type Held = { cells: number; pages: Promise<WorldRootsPage[]> }
/** Told that `bundle` is held now, or let go. */
type Watcher = (bundle: number, held: boolean) => void

/**
 * The held cells' share of the root cover: the room the cut's cache leaves the roots they add, set
 * by the cache that keeps them (`../webgpu/pages/prepare/worldRoot.ts`) — none, any cell may be
 * held —, and whether a cell may be held far within it: the roots `rootsIn` counts in the bundles
 * of `bundlesOf` it needs that no cell holds yet. A cell refused is asked again only once that
 * room grows: whatever else the cells hold meanwhile moves the room and its roots alike.
 */
function createCoverShare(
  bundlesOf: (cell: number) => Int32Array,
  held: ReadonlyMap<number, unknown>,
  rootsIn: (bundle: number) => number,
) {
  /** Per cell, the roots each of its bundles adds, counted once; per cell refused, the room. */
  const roots: Int32Array[] = [],
    refused = new Map<number, number>()
  const share = {
    room: undefined as (() => number) | undefined,
    admits(cell: number) {
      const room = share.room?.()
      if (room === undefined) return true
      if (room <= (refused.get(cell) ?? -1)) return false
      const bundles = bundlesOf(cell),
        adds = (roots[cell] ??= Int32Array.from(bundles, rootsIn))
      let added = 0
      for (let i = 0; i < bundles.length; i++) if (!held.has(bundles[i])) added += adds[i]
      if (added <= room) refused.delete(cell)
      else refused.set(cell, room)
      return added <= room
    },
  }
  return share
}

/** The bundles past the top the held cells of `table` hold, each read through `read`; `rootsIn`
 *  counts the roots a bundle holds for its cell, which join the cover with it (`cover`). */
export function createHeldBundles(
  table: WorldRoots,
  read: (bundle: number) => Promise<WorldRootsPage[]>,
  rootsIn: (bundle: number) => number = () => 0,
) {
  const held = new Map<number, Held>(),
    watchers = new Set<Watcher>()
  let bytes = 0
  /** Per cell, the bundles past the top it needs, listed once. */
  const needs: Int32Array[] = []
  const bundlesOf = (cell: number) =>
    (needs[cell] ??= Int32Array.from(cellDependencies(table, cell)))
  const release = (cell: number) => {
    for (const bundle of bundlesOf(cell)) {
      const own = held.get(bundle)
      if (!own || --own.cells > 0) continue
      held.delete(bundle)
      bytes -= table.bundles[bundle].bytes
      for (const watcher of watchers) watcher(bundle, false)
    }
  }
  const hold = async (cell: number) => {
    const reads = Array.from(bundlesOf(cell), (bundle) => {
      let own = held.get(bundle)
      if (!own) {
        held.set(bundle, (own = { cells: 0, pages: read(bundle) }))
        bytes += table.bundles[bundle].bytes
        for (const watcher of watchers) watcher(bundle, true)
      }
      own.cells++
      return own.pages
    })
    await Promise.all(reads).catch((error: unknown) => {
      release(cell)
      throw error
    })
  }
  /** Tells `watcher` each bundle held from now on, those held already first; returns what stops. */
  const watch = (watcher: Watcher) => {
    watchers.add(watcher)
    for (const bundle of held.keys()) watcher(bundle, true)
    return () => void watchers.delete(watcher)
  }
  const cover = createCoverShare(bundlesOf, held, rootsIn)
  return { held, hold, release, watch, cover, bytes: () => bytes }
}
