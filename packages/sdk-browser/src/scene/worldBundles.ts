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
 * Who follows the cells' bundles watches each as the first cell holds it and the last lets it go
 * (`watch`): the roots one cell alone needs they carry (`top.rs`) join the cut's cache cover while
 * held (`../webgpu/pages/prepare/worldRoot.ts`), within the room that cache leaves (`cover`). A
 * bundle a page read holds for itself alone is no cell's: no watcher hears it.
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
import { createCoverShare } from './worldCoverShare.ts'

/** How a cell holds: the read priority of its bundles, and the signal that lets its hold go — the
 *  session's life when it names none. */
type WorldHold = { signal?: AbortSignal; priority?: number }
/** A bundle held: how many holds — a cell's or a page read's —, how many of them cells', and its
 *  pages once read. */
type Held = { holds: number; byCells: number; pages?: WorldRootsPage[]; failed?: boolean }
/** Told that `bundle` is held by a cell now, or by none any more. */
type Watcher = (bundle: number, held: boolean) => void

/** The bundles of `table` the cells hold, each counted once whatever the cells sharing it, their
 *  bytes in `bytes`; and each cell's bundles, listed on its first hold. Its `watchers` hear each
 *  bundle the cells start or stop holding. */
function createBundleCounts(
  table: WorldRoots,
  watchers: Set<Watcher>,
  cellBundles: ReturnType<typeof createCellBundles>,
) {
  const held = new Map<number, Held>()
  /** Each cell held: its holds, each released once. */
  const cells = new Map<number, number>()
  let bytes = 0
  const counts = {
    held,
    bytes: () => bytes,
    /** `bundle` held once more, by a cell (`byCell`) or a page read. */
    take(bundle: number, byCell = false) {
      let own = held.get(bundle)
      if (!own) {
        held.set(bundle, (own = { holds: 0, byCells: 0 }))
        bytes += table.bundles[bundle].bytes
      }
      own.holds++
      if (byCell && own.byCells++ === 0 && !own.failed)
        for (const watcher of watchers) watcher(bundle, true)
      return own
    },
    letGo(bundle: number, byCell = false) {
      const own = held.get(bundle)
      if (!own) return
      if (byCell && --own.byCells === 0 && !own.failed)
        for (const watcher of watchers) watcher(bundle, false)
      if (--own.holds > 0) return
      held.delete(bundle)
      bytes -= table.bundles[bundle].bytes
    },
    /** `bundle`'s read failed for good: its cells still hold it till they leave, but its roots,
     *  which can never load, leave who follows it at once. */
    failed(bundle: number) {
      const own = held.get(bundle)
      if (!own || own.failed) return
      own.failed = true
      if (own.byCells > 0) for (const watcher of watchers) watcher(bundle, false)
    },
    /** Whether a cell holds `bundle`. */
    byCells: (bundle: number) => (held.get(bundle)?.byCells ?? 0) > 0,
    /** Whether who follows the cells' bundles holds `bundle`: a cell does, its read not refused. */
    followed: (bundle: number) => counts.byCells(bundle) && !held.get(bundle)!.failed,
    /** `cell` left: its bundles are let go, once. */
    release(cell: number) {
      const holds = cells.get(cell)
      if (!holds) return
      for (const bundle of cellBundles(cell)) counts.letGo(bundle, true)
      if (holds === 1) cells.delete(cell)
      else cells.set(cell, holds - 1)
    },
    /** Whether a hold keeps `cell`. */
    holds: (cell: number) => cells.has(cell),
    /** `cell`'s bundles, counted once more. */
    listed(cell: number) {
      cells.set(cell, (cells.get(cell) ?? 0) + 1)
      return cellBundles(cell)
    },
  }
  return counts
}

/** Per cell of `table`, the bundles past the top it needs: the one list of a cell, made once while
 *  the cell is held or asked of, forgotten as it is let go. */
function createCellBundles(table: WorldRoots) {
  const lists = new Map<number, readonly number[]>()
  const of = (cell: number) => {
    let bundles = lists.get(cell)
    if (!bundles) lists.set(cell, (bundles = cellDependencies(table, cell)))
    return bundles
  }
  return Object.assign(of, { forget: (cell: number) => void lists.delete(cell) })
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
export function createWorldBundles(
  table: WorldRoots,
  url: string,
  top: WorldRootsPage[][],
  rootsIn: (bundle: number) => number = () => 0,
) {
  const watchers = new Set<Watcher>(),
    cellBundles = createCellBundles(table),
    counts = createBundleCounts(table, watchers, cellBundles),
    { held, take, letGo, listed } = counts
  const byCell = (bundle: number) => take(bundle, true)
  // A cell the cover forgets — let go, or past the plan's reach — that no hold keeps: its bundles'
  // list goes with its counts.
  const binding = createBinding(table, url),
    cover = createCoverShare(cellBundles, counts.byCells, rootsIn, (cell) => {
      if (!counts.holds(cell)) cellBundles.forget(cell)
    })
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
            (error: unknown) => {
              // Refused for good, not let go: no read of this session would pass.
              if (!signal.aborted && !session.signal.aborted) counts.failed(bundles[at])
              throw error
            },
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
        owns = bundles.map(byCell)
      asked.signal?.throwIfAborted()
      await read(bundles, owns, asked)
    },
    /** `cell` left: a bundle no placed cell needs any more is let go, and what was counted of the
     *  cell once no hold keeps it. */
    release(cell: number) {
      counts.release(cell)
      if (!counts.holds(cell)) cover.forget(cell)
    },
    /** `cell`'s bundles read in their runs by `read` and held for the scene's life: what a world's
     *  model not partitioned, one cell, holds from its load, before any session. */
    async keep(cell: number, read: SpanRead) {
      const bundles = listed(cell)
      await readAtOpen(bundles, bundles.map(byCell), read)
    },
    /** A bundle's pages: the pinned top's, else held for the one request while it reads, as a cell
     *  holds it, till `signal` — its askers' — lets it go, and let go once read (the GPU page pool
     *  keeps what it uploads). */
    async pages(bundle: number, signal: AbortSignal, priority?: number) {
      if (bundle < table.pinned) return top[bundle]
      const own = take(bundle)
      try {
        await read([bundle], [own], { signal, priority })
        return own.pages!
      } finally {
        letGo(bundle)
      }
    },
    has: (bundle: number) => held.has(bundle),
    /** The bundles past the top the cells hold now, ascending, those refused for good left out. */
    held: () => [...held.keys()].filter(counts.followed).sort((a, b) => a - b),
    /** Tells `watcher` each bundle the cells hold from now on, those held already first; returns
     *  what stops it. */
    watch(watcher: Watcher) {
      watchers.add(watcher)
      for (const bundle of held.keys()) if (counts.followed(bundle)) watcher(bundle, true)
      return () => void watchers.delete(watcher)
    },
    /** The room the cut's cache leaves the roots the held cells add, and whether a cell may be
     *  held far within it (`worldCoverShare.ts`), the roots `rootsIn` counts per bundle. */
    cover,
    /** The bytes of the bundles held. */
    bytes: counts.bytes,
    /** The session's queue the bundles are read through: they join its catalogue, once. */
    bind: binding.bind,
  }
}
