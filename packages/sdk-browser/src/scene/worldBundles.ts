/**
 * THE WORLD BUNDLES PAST THE PINNED TOP THE PLACED CELLS HOLD, READ THROUGH THE SESSION'S QUEUE.
 *
 * A placed cell holds the bundles its objects' roots need (`cellDependencies`, listed once per
 * cell), each counted once whatever the cells sharing it, and lets them go when it leaves. Each
 * bundle is a page of the session's one read queue (`worldRuns.ts`), asked by each hold with its
 * own signal at the priority its cell holds with — after the view's own pages, nearer first, the
 * prefetch ring last (`holdPriority`) —, so no more than the queue's transfers are in flight
 * whatever the cells in reach, and the bundles queued end to end in the binary are one request.
 * The queue is the one shared read: a bundle on its way is one read whoever asks it, a more urgent
 * hold lifts it, and one no hold waits on is dropped unread while it waits. A read that fails and
 * may pass waits its turn in the queue, the holds still waiting (`../streaming/failures.ts`); one
 * that fails for good is refused at once. A hold whose session closed while it read waits for the
 * next session's queue (`bind`), and reads there.
 *
 * Cost, for C cells in reach holding b bundles each, K transfers and t the time of one read: at
 * most K requests in flight and K / t started a second whatever C, each bundle read once while it
 * is held or on its way, O(b) work per hold or release and none per frame. Floor: the first view's
 * reads take ⌈reads / K⌉ round trips beside their bytes over the bandwidth.
 */
import {
  cellDependencies,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import { waited } from '../../../sdk-core/src/runtime/sharedRead.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { PageQueue } from '../streaming/types.ts'
import { bundlePages, readAtOpen, readBundle, type SpanRead } from './worldRuns.ts'

/** How a cell holds: the read priority of its bundles, and the signal that lets its hold go — the
 *  session's life when it names none. */
type WorldHold = { signal?: AbortSignal; priority?: number }
/** A bundle held: how many cells, and its pages once read. */
type Held = { cells: number; pages?: WorldRootsPage[] }

/** The bundles of `table` the cells hold, each counted once whatever the cells sharing it, their
 *  bytes in `bytes`; and each cell's bundles, listed on its first hold. */
function createBundleCounts(table: WorldRoots) {
  const held = new Map<number, Held>()
  /** Each cell held: its bundles, and its holds, each released once. */
  const cells = new Map<number, { bundles: readonly number[]; holds: number }>()
  let bytes = 0
  const counts = {
    held,
    bytes: () => bytes,
    take(bundle: number) {
      let own = held.get(bundle)
      if (!own) {
        held.set(bundle, (own = { cells: 0 }))
        bytes += table.bundles[bundle].bytes
      }
      own.cells++
      return own
    },
    letGo(bundle: number) {
      const own = held.get(bundle)
      if (!own || --own.cells > 0) return
      held.delete(bundle)
      bytes -= table.bundles[bundle].bytes
    },
    /** `cell` left: its bundles are let go, once. */
    release(cell: number) {
      const own = cells.get(cell)
      if (!own) return
      own.bundles.forEach(counts.letGo)
      if (--own.holds === 0) cells.delete(cell)
    },
    /** `cell`'s bundles, counted once more. */
    listed(cell: number) {
      let own = cells.get(cell)
      if (own) own.holds++
      else cells.set(cell, (own = { bundles: cellDependencies(table, cell), holds: 1 }))
      return own.bundles
    },
  }
  return counts
}

/** The session's queue a world's bundles are read through: bound by each session, let go as it
 *  closes; a read asked while none is bound waits for the next (`next`). */
function createBinding(table: WorldRoots, url: string) {
  let queue: PageQueue | undefined, bind!: (session: PageQueue) => void
  let bound = new Promise<PageQueue>((resolve) => (bind = resolve))
  /** `session` closed: a read asked from now on waits for the next one. */
  const closed = (session: PageQueue) => {
    if (queue !== session) return
    queue = undefined
    bound = new Promise<PageQueue>((resolve) => (bind = resolve))
  }
  return {
    /** The queue bound now, else the next one bound, waited on till `signal` lets go: a closed
     *  queue is never handed out. */
    next(signal?: AbortSignal) {
      if (queue?.signal.aborted) closed(queue)
      return queue ? Promise.resolve(queue) : waited(bound, signal)
    },
    /** `session` reads the bundles from now on; one already closed — its device lost before it
     *  bound — is refused. */
    bind(session: PageQueue) {
      if (queue === session || session.signal.aborted) return
      session.admit(bundlePages(table, url, table.pinned))
      queue = session
      bind(session)
      session.signal.addEventListener('abort', () => closed(session), { once: true })
    },
  }
}

/** The bundles past the pinned top of `table`'s binary at `url` the placed cells hold, read
 *  through the queue each session binds (`bind`); `top` the pinned top's pages. */
export function createWorldBundles(table: WorldRoots, url: string, top: WorldRootsPage[][]) {
  const counts = createBundleCounts(table),
    { held, take, letGo, listed } = counts
  const binding = createBinding(table, url)
  /** The pages of `bundles` not read yet, held as `owns`, read through `session` as `asked`. */
  const readOn = (
    session: PageQueue,
    bundles: readonly number[],
    owns: Held[],
    asked: WorldHold,
  ) => {
    const signal = asked.signal ?? session.signal,
      priority = asked.priority ?? PRIORITY_VISIBLE
    const reads = owns.map((own, at) =>
      own.pages
        ? undefined
        : readBundle(session, table, url, bundles[at], signal, priority).then(
            (pages) => void (own.pages ??= pages),
          ),
    )
    return Promise.all(reads)
  }
  /** The pages of `bundles`, held as `owns`, read as `asked`: a read its session's close stopped
   *  is asked again of the next session's queue. */
  const read = async (bundles: readonly number[], owns: Held[], asked: WorldHold) => {
    for (;;) {
      const session = await binding.next(asked.signal)
      try {
        return void (await readOn(session, bundles, owns, asked))
      } catch (error) {
        if (!session.signal.aborted || asked.signal?.aborted) throw error
      }
    }
  }
  return {
    /** `cell` is placed: the bundles its objects' roots need past the top are held, those neither
     *  read nor on their way read. Each hold is released once (`release`), landed or not: a hold
     *  that failed keeps its bundles wanted till then, and one whose `signal` aborted stops waiting,
     *  its bundles read on for another hold that waits on them. */
    async hold(cell: number, asked: WorldHold = {}) {
      const bundles = listed(cell),
        owns = bundles.map(take)
      asked.signal?.throwIfAborted()
      await read(bundles, owns, asked)
    },
    /** `cell` left: a bundle no placed cell needs any more is let go. */
    release: counts.release,
    /** `cell`'s bundles read in their runs by `read` and held for the scene's life: what a world's
     *  model not partitioned, one cell, holds from its load, before any session. */
    async keep(cell: number, read: SpanRead) {
      const bundles = listed(cell)
      await readAtOpen(bundles, bundles.map(take), read)
    },
    /** A bundle's pages: the pinned top's, else held for the one request while it reads, as a cell
     *  holds it, till `signal` — its askers' — lets it go, and let go once read (the GPU page pool
     *  keeps what it uploads). */
    async pages(bundle: number, signal: AbortSignal) {
      if (bundle < table.pinned) return top[bundle]
      const own = take(bundle)
      try {
        await read([bundle], [own], { signal })
        return own.pages!
      } finally {
        letGo(bundle)
      }
    },
    has: (bundle: number) => held.has(bundle),
    /** The bytes of the bundles held. */
    bytes: counts.bytes,
    /** The session's queue the bundles are read through: they join its catalogue, once. */
    bind: binding.bind,
  }
}
