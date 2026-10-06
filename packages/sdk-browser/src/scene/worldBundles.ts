/**
 * THE WORLD BUNDLES PAST THE PINNED TOP THE PLACED CELLS HOLD, READ THROUGH THE SESSION'S QUEUE.
 *
 * A placed cell holds the bundles its objects' roots need (`cellDependencies`), each counted once
 * whatever the cells sharing it, and lets them go when it leaves. Those neither held nor on their
 * way are read in runs: a cell's bundles contiguous in the binary are one ranged request, a page of
 * the session's one read queue (`worldRuns.ts`), asked at the priority its cell holds with — after
 * the view's own pages, nearer first, the prefetch ring last (`holdPriority`) —, so no more than
 * the queue's transfers are in flight whatever the cells in reach. A run is read for the bundles
 * held on it, whoever asked: it lands into every one still held on it — a bundle on its way is
 * shared, never read twice —, and stops, dropped unread while it waits in the queue, once none is.
 * A hold waits on the runs its bundles are on with its own signal; one more urgent than a run's
 * read lifts it in the queue. A failed run keeps its bundles wanted, the queue refusing its page
 * at once while its wait runs (`../streaming/failures.ts`), and the next hold reads it again.
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
import type { PageQueue } from '../streaming/types.ts'
import {
  bundleIn,
  readAtOpen,
  runPage,
  startRuns,
  type Held,
  type Run,
  type SpanRead,
} from './worldRuns.ts'

/** How a cell holds: the read priority of its runs, and the signal that lets its hold go. */
type WorldHold = { signal?: AbortSignal; priority?: number }

/** The runs of `table`'s binary at `url` read through the session's queue (`bind`), each viewed,
 *  as it lands, on the bundles of `held` still on it. */
function createRuns(table: WorldRoots, url: string, held: Map<number, Held>) {
  let queue: PageQueue | undefined
  /** The session's queue: a cell holds only within a session, which binds it first. */
  const bound = () => {
    if (!queue) throw new Error('WORLD_ROOTS_UNBOUND: a cell holds within a session')
    return queue
  }
  /** Bundles `[first, end)`, a page of the queue read at `priority`. */
  const run = (first: number, end: number, priority = PRIORITY_VISIBLE) => {
    const page = runPage(table, url, first, end),
      queue = bound(),
      stop = new AbortController()
    queue.admit([page])
    const own = { first, end, url: page.url, stop } as Run
    own.landing = queue.readBytes(own.url, stop.signal, priority).then((bytes) => {
      // Every bundle still held on it gets its pages, all or — one refused, it failed — none.
      const views: [Held, WorldRootsPage[]][] = []
      for (let bundle = first; bundle < end; bundle++) {
        const waiting = held.get(bundle)
        if (waiting?.run === own) views.push([waiting, bundleIn(bytes, table, first, bundle)])
      }
      for (const [waiting, pages] of views) [waiting.pages, waiting.run] = [pages, undefined]
      queue.forget([own.url]) // landed: its page leaves the catalogue
      return bytes
    })
    own.landing.catch(() => stop.abort()) // failed: read again by the next hold
    return own
  }
  /** No held bundle is on `own`'s page any more: its read stops, and it leaves the catalogue with
   *  its failure if it failed. */
  const forsake = (own: Run) => {
    for (let bundle = own.first; bundle < own.end; bundle++)
      if (held.get(bundle)?.run?.url === own.url) return
    own.stop.abort()
    queue?.forget([own.url])
  }
  /** `own` waited on by a hold as `asked`: its read joined at its priority — one more urgent lifts
   *  it in the queue — till its signal lets it go, then its bundles' pages in. */
  const join = async (own: Run, { signal, priority = PRIORITY_VISIBLE }: WorldHold) => {
    await bound().readBytes(own.url, signal, priority)
    await own.landing
  }
  return {
    forsake,
    /** The pages of `bundles`, held as `owns`, read as `asked`: their runs started (`startRuns`),
     *  the stopped ones they replace forsaken, and every run they wait on joined. */
    async read(bundles: readonly number[], owns: readonly Held[], asked: WorldHold) {
      startRuns(bundles, owns, (first, end) => run(first, end, asked.priority)).forEach(forsake)
      const waits = new Set<Run>()
      for (const own of owns) if (own.run) waits.add(own.run)
      await Promise.all([...waits].map((own) => join(own, asked)))
    },
    bind(session: PageQueue) {
      queue = session
    },
  }
}

/** The bundles past the pinned top of `table`'s binary at `url` the placed cells hold, read
 *  through the queue the session binds (`bind`); `top` the pinned top's pages. */
export function createWorldBundles(table: WorldRoots, url: string, top: WorldRootsPage[][]) {
  const held = new Map<number, Held>()
  const runs = createRuns(table, url, held)
  let heldBytes = 0
  const take = (bundle: number) => {
    let own = held.get(bundle)
    if (!own) {
      held.set(bundle, (own = { cells: 0 }))
      heldBytes += table.bundles[bundle].bytes
    }
    own.cells++
    return own
  }
  const letGo = (bundle: number) => {
    const own = held.get(bundle)
    if (!own || --own.cells > 0) return
    held.delete(bundle)
    heldBytes -= table.bundles[bundle].bytes
    if (own.run) runs.forsake(own.run)
  }
  return {
    /** `cell` is placed: the bundles its objects' roots need past the top are held, those neither
     *  read nor on their way read. Each hold is released once (`release`), landed or not: a hold
     *  that failed keeps its bundles wanted till then, and one whose `signal` aborted stops waiting,
     *  its runs read on while a held bundle is on them. */
    async hold(cell: number, asked: WorldHold = {}) {
      const bundles = cellDependencies(table, cell),
        owns = bundles.map(take)
      asked.signal?.throwIfAborted()
      await runs.read(bundles, owns, asked)
    },
    /** `cell` left: a bundle no placed cell needs any more is let go. */
    release: (cell: number) => cellDependencies(table, cell).forEach(letGo),
    /** `cell`'s bundles read in their runs by `read` and held for the scene's life: what a scene
     *  not partitioned, one cell, holds from its open. */
    async keep(cell: number, read: SpanRead) {
      const bundles = cellDependencies(table, cell)
      await readAtOpen(bundles, bundles.map(take), read)
    },
    /** A bundle's pages: the pinned top's, else held for the one request while it reads, as a cell
     *  holds it, and let go once read (the GPU page pool keeps what it uploads). */
    async pages(bundle: number) {
      if (bundle < table.pinned) return top[bundle]
      const own = take(bundle)
      try {
        if (!own.pages) await runs.read([bundle], [own], {})
        return own.pages!
      } finally {
        letGo(bundle)
      }
    },
    /** The bundles held now, ascending. */
    held: () => [...held.keys()].sort((a, b) => a - b),
    has: (bundle: number) => held.has(bundle),
    /** The bytes of the bundles held. */
    bytes: () => heldBytes,
    /** The session's queue the runs are read through. */
    bind: runs.bind,
  }
}
