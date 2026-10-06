/**
 * THE WORLD BUNDLES PAST THE PINNED TOP THE PLACED CELLS HOLD, READ THROUGH THE SESSION'S QUEUE.
 *
 * A placed cell holds the bundles its objects' roots need (`cellDependencies`), each counted once
 * whatever the cells sharing it, and lets them go when it leaves. Those neither held nor on their
 * way are read in runs: a cell's bundles contiguous in the binary are one ranged request. Every run
 * waits in the session's one read queue, the page streamer's (`RangedRead`), at the priority its
 * cell holds with — after the view's own pages, nearer first, the prefetch ring last
 * (`holdPriority`) —, so no more than the queue's transfers are in flight whatever the cells in
 * reach. A bundle on its way is shared, never read twice; a hold whose signal aborts counts
 * nothing, and a run no held bundle wants any more is dropped from the queue unread. Until the
 * session opens its queue (a scene's load), a run is read at once.
 *
 * Cost, for C cells in reach holding b bundles in r contiguous runs each (r ≤ b), K transfers and
 * t the time of one read: at most K requests in flight and K / t started a second whatever C, C·r
 * requests in all with each bundle read once, O(b) work per hold or release and none per frame.
 * Floor: the first view's reads take ⌈reads / K⌉ round trips beside their bytes over the bandwidth.
 */
import {
  cellDependencies,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { createRuns, Flight } from './worldRuns.ts'

type Runs = ReturnType<typeof createRuns>

/** `pages`, or the reason `signal` aborts with, whichever comes first. */
function unlessAborted<T>(pages: Promise<T>, signal?: AbortSignal) {
  if (!signal) return pages
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason)
    if (signal.aborted) return stop()
    signal.addEventListener('abort', stop, { once: true })
    void pages.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}

/** How a cell holds: the read priority of its runs, and the signal that lets its hold go. */
type WorldHold = { signal?: AbortSignal; priority?: number }

/** The bundles past the pinned top of `table` the placed cells hold, read in `runs`; `top` the
 *  pinned top's pages. */
export function createWorldBundles(table: WorldRoots, runs: Runs, top: WorldRootsPage[][]) {
  const { flying } = runs
  /** The bundles a cell holds, with how many cells. */
  const held = new Map<number, Flight & { cells: number }>()
  let heldBytes = 0
  /** One cell more holds `bundle`, held or on its way: its pages. */
  const take = (bundle: number) => {
    let own = held.get(bundle)
    if (!own) {
      held.set(bundle, (own = { ...flying.get(bundle)!, cells: 0 }))
      own.run.wanted++
      heldBytes += table.bundles[bundle].bytes
    }
    own.cells++
    return own.pages
  }
  /** One cell less holds `bundle`: let go by the last, its run dropped once none is wanted. */
  const letGo = (bundle: number) => {
    const own = held.get(bundle)
    if (!own || --own.cells > 0) return
    held.delete(bundle)
    heldBytes -= table.bundles[bundle].bytes
    if (--own.run.wanted === 0) runs.drop(own.run)
  }
  const release = (cell: number) => cellDependencies(table, cell).forEach(letGo)
  const missing = (bundle: number) => !held.has(bundle) && !flying.has(bundle)
  return {
    /** `cell` is placed: the bundles its objects' roots need past the top are held, those not held
     *  read. A hold that fails, or whose `signal` aborts, holds nothing of the cell. */
    async hold(cell: number, { signal, priority = PRIORITY_VISIBLE }: WorldHold = {}) {
      signal?.throwIfAborted()
      const bundles = cellDependencies(table, cell)
      runs.readMissing(bundles.filter(missing), priority)
      await unlessAborted(Promise.all(bundles.map(take)), signal).catch((error: unknown) => {
        release(cell)
        throw error
      })
    },
    /** `cell` left: a bundle no placed cell needs any more is let go. */
    release,
    /** A bundle's pages: the pinned top's, held or on its way, else read for the one request at
     *  the view's priority (the GPU page pool keeps what it uploads). */
    pages: (bundle: number) =>
      bundle < table.pinned
        ? Promise.resolve(top[bundle])
        : ((held.get(bundle) ?? flying.get(bundle))?.pages ?? runs.once(bundle)),
    /** The bundles held now, ascending. */
    held: () => [...held.keys()].sort((a, b) => a - b),
    /** Whether a cell holds `bundle`. */
    holds: (bundle: number) => held.has(bundle),
    /** The bytes of the bundles held. */
    bytes: () => heldBytes,
    /** The session's read queue, which every later run waits in (`RangedRead`). */
    readThrough: runs.readThrough,
  }
}
