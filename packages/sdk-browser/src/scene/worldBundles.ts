/**
 * THE WORLD BUNDLES PAST THE PINNED TOP THE PLACED CELLS HOLD, READ THROUGH THE SESSION'S QUEUE.
 *
 * A placed cell holds the bundles its objects' roots need (`cellDependencies`, listed once per
 * cell), each counted once whatever the cells sharing it, and lets them go when it leaves. Each
 * bundle is a page of the session's one read queue (`worldRuns.ts`, admitted once as it binds),
 * asked at the priority its cell holds with — after the view's own pages, nearer first, the
 * prefetch ring last (`holdPriority`) —, so no more than the queue's transfers are in flight
 * whatever the cells in reach, and the bundles queued end to end in the binary are one request.
 * The queue does the rest: a bundle on its way is one read whoever asks it, a more urgent hold
 * lifts it, and one no hold waits on is dropped unread while it waits. A bundle wanted has its own
 * read, which lands its pages into it whoever asked and stops once it is let go; each hold waits on
 * it with its own signal. A read that fails and may pass waits its turn in the queue, the holds
 * still waiting (`../streaming/failures.ts`); one that fails for good is refused at once.
 *
 * Cost, for C cells in reach holding b bundles each, K transfers and t the time of one read: at
 * most K requests in flight and K / t started a second whatever C, each bundle read once, O(b) work
 * per hold or release and none per frame. Floor: the first view's reads take ⌈reads / K⌉ round
 * trips beside their bytes over the bandwidth.
 */
import {
  cellDependencies,
  worldBundlePages,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import { waited } from '../../../sdk-core/src/runtime/sharedRead.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { PageQueue } from '../streaming/types.ts'
import { bundlePages, bundleUrl, readAtOpen, type SpanRead } from './worldRuns.ts'

/** How a cell holds: the read priority of its bundles, and the signal that lets its hold go. */
type WorldHold = { signal?: AbortSignal; priority?: number }
/** A bundle held: how many cells, its pages once read, and till then its own read — at the most
 *  urgent priority a hold asked —, stopped once it is let go. */
type Held = { cells: number; pages?: WorldRootsPage[]; reading?: Reading }
type Reading = { landing: Promise<void>; stop: AbortController; priority: number }

/** The bundles past the pinned top of `table`'s binary at `url` the placed cells hold, read
 *  through the queue the session binds (`bind`); `top` the pinned top's pages. */
export function createWorldBundles(table: WorldRoots, url: string, top: WorldRootsPage[][]) {
  const held = new Map<number, Held>()
  /** Each cell held: its bundles, and its holds, each released once. */
  const cells = new Map<number, { bundles: readonly number[]; holds: number }>()
  let queue: PageQueue | undefined, bind!: (session: PageQueue) => void
  /** The session's queue, once it binds it: a hold asked before waits for it. */
  const bound = new Promise<PageQueue>((resolve) => (bind = resolve))
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
    own.reading?.stop.abort()
  }
  /** The read of `own`, bundle `bundle`, through `session` as a hold asks it at `priority`: its
   *  own, started once and landing its pages into it whoever waits — failed, the next hold reads it
   *  again —, or the one on its way, which a more urgent hold lifts in the queue by joining it till
   *  its `signal` lets it go. */
  const reading = (session: PageQueue, bundle: number, own: Held, asked: WorldHold) => {
    const page = bundleUrl(url, bundle),
      priority = asked.priority ?? PRIORITY_VISIBLE,
      was = own.reading
    if (was && !was.stop.signal.aborted) {
      if (priority >= was.priority) return was
      was.priority = priority
      session.readBytes(page, asked.signal, priority).catch(() => {})
      return was
    }
    const stop = new AbortController()
    const landing = session.readBytes(page, stop.signal, priority).then((bytes) => {
      own.pages = worldBundlePages(bytes, table.bundles[bundle].count, bundle)
    })
    landing.catch(() => stop.abort())
    return (own.reading = { landing, stop, priority })
  }
  /** The pages of `bundles`, held as `owns`, read as `asked`, each waited on till its signal
   *  lets the hold go. */
  const read = async (bundles: readonly number[], owns: readonly Held[], asked: WorldHold) => {
    const session = queue ?? (await waited(bound, asked.signal))
    const reads = owns.map((own, at) =>
      own.pages
        ? undefined
        : waited(reading(session, bundles[at], own, asked).landing, asked.signal),
    )
    await Promise.all(reads)
  }
  /** `cell`'s bundles, listed on its first hold, counted once more. */
  const listed = (cell: number) => {
    let own = cells.get(cell)
    if (own) own.holds++
    else cells.set(cell, (own = { bundles: cellDependencies(table, cell), holds: 1 }))
    return own.bundles
  }
  return {
    /** `cell` is placed: the bundles its objects' roots need past the top are held, those neither
     *  read nor on their way read. Each hold is released once (`release`), landed or not: a hold
     *  that failed keeps its bundles wanted till then, and one whose `signal` aborted stops waiting,
     *  its bundles read on while held. */
    async hold(cell: number, asked: WorldHold = {}) {
      const bundles = listed(cell),
        owns = bundles.map(take)
      asked.signal?.throwIfAborted()
      await read(bundles, owns, asked)
    },
    /** `cell` left: a bundle no placed cell needs any more is let go. */
    release(cell: number) {
      const own = cells.get(cell)
      if (!own) return
      own.bundles.forEach(letGo)
      if (--own.holds === 0) cells.delete(cell)
    },
    /** `cell`'s bundles read in their runs by `read` and held for the scene's life: what a scene
     *  not partitioned, one cell, holds from its open. */
    async keep(cell: number, read: SpanRead) {
      const bundles = listed(cell)
      await readAtOpen(bundles, bundles.map(take), read)
    },
    /** A bundle's pages: the pinned top's, else held for the one request while it reads, as a cell
     *  holds it, and let go once read (the GPU page pool keeps what it uploads). */
    async pages(bundle: number) {
      if (bundle < table.pinned) return top[bundle]
      const own = take(bundle)
      try {
        await read([bundle], [own], {})
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
    /** The session's queue the bundles are read through: they join its catalogue, once. */
    bind(session: PageQueue) {
      session.admit(bundlePages(table, url))
      bind((queue = session))
    },
  }
}
