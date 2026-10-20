/**
 * THE WORLD BUNDLES THE HLOD CELLS HOLD, READ THROUGH THE SESSION'S QUEUE.
 *
 * An HLOD cell whose actor is loaded holds the bundles of its actor's roots
 * (`WorldRoots.hlod`), each counted once whatever the cells sharing it, and lets them go when it is
 * released (`../partition/hlodCells.ts`). Each bundle is a page of the session's one read queue
 * (`worldRuns.ts`), asked by each hold with its own signal at the priority its cell holds with —
 * after the view's own pages, nearer first —, so no more than the queue's transfers are in flight
 * whatever the cells in reach, and the bundles queued end to end in the binary are one request.
 * The queue is the one shared read: a bundle on its way is one read whoever asks it, a more urgent
 * hold lifts it, and one no hold waits on is dropped unread while it waits. A read that fails and
 * may pass waits its turn in the queue, the holds still waiting (`../streaming/failures.ts`); one
 * that fails for good is refused at once. A hold whose session closed while it read waits for the
 * next session's queue (`bind`), and reads there.
 *
 * A bundle held is pinned in the page cache of the session it was read through, its pages served
 * from it by the one reader every page goes through (`worldRuns.ts`); a session that binds pins
 * again what the holds keep.
 *
 * The top cells — those whose actor is its chain's top, always loaded, one per large cell
 * (`compiler_tables/partition/hlod.rs`) — hold within a budget of their own (`topBudget`): what it
 * leaves free is reserved off the cache's total (`reserve`), so the bundles the tops hold never take
 * the room of the pages the view needs, and the view's never evict them. A top cell whose bundles
 * would pass that budget is refused, by name (`WORLD_TOP_BUDGET`): its hold fails for good, its
 * content standing for it (`../gpu/dag/worldFollow.ts`), and the refusals are counted (`top`).
 *
 * Who follows the cells' bundles watches each as the first cell holds it and the last lets it go
 * (`watch`): the roots they carry join the cut's cache cover while held
 * (`../webgpu/pages/prepare/worldRoot.ts`).
 *
 * Cost, for C cells in reach holding b bundles each, K transfers and t the time of one read: at
 * most K requests in flight and K / t started a second whatever C, each bundle read once while it
 * is held or on its way, O(b) work per hold or release and none per frame. Floor: the first view's
 * reads take ⌈reads / K⌉ round trips beside their bytes over the bandwidth.
 */
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { waited } from '../../../sdk-core/src/runtime/sharedRead.ts'
import { createListeners, type Listeners } from '../../../sdk-core/src/runtime/listeners.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { PageQueue, StreamPage } from '../streaming/types.ts'
import { readWhole, worldBundleAddress, worldPages } from './worldRuns.ts'
import { createDeferred } from '../../../sdk-core/src/runtime/deferred.ts'
import { countBy } from '../../../math/src/sequence/counts.ts'
import { MIB } from '../../../math/src/constants.ts'

/** The bytes the top cells' bundles may hold at most by default: a world's always-loaded actors,
 *  one per 2 048 m cell, some 1 250 over 50 km for two chains. */
export const WORLD_TOP_BUDGET = 128 * MIB

/** How a cell holds: the read priority of its bundles, and the signal that lets its hold go — the
 *  session's life when it names none. */
type WorldHold = { signal?: AbortSignal; priority?: number }
/** A bundle held: how many cells hold it — top cells among them —, the most urgent priority a
 *  hold asked it at, and the session whose cache pins it once read. */
type Held = {
  cells: number
  tops: number
  priority: number
  pinnedIn?: PageQueue
  failed?: boolean
}
/** Told that `bundle` is held by a cell now, or by none any more. */
type Watcher = (bundle: number, held: boolean) => void

/** The bundles of `table` the cells hold, each counted once whatever the cells sharing it; and
 *  each cell's bundles, listed on its first hold. Its `watchers` hear each bundle the cells start
 *  or stop holding. */
function createBundleCounts(
  table: WorldRoots,
  url: string,
  watchers: Listeners<Parameters<Watcher>>,
  cellBundles: (cell: number) => readonly number[],
) {
  const held = new Map<number, Held>()
  /** Each cell held: its holds, each released once. */
  const cells = new Map<number, number>()
  const counts = {
    held,
    /** `bundle` held by one more cell. */
    take(bundle: number) {
      let own = held.get(bundle)
      if (!own) held.set(bundle, (own = { cells: 0, tops: 0, priority: Infinity }))
      if (own.cells++ === 0) watchers.emit(bundle, true)
      return own
    },
    /** `bundle` held by one cell less: let go, unpinned, with the last. */
    letGo(bundle: number) {
      const own = held.get(bundle)
      if (!own || --own.cells > 0) return
      if (!own.failed) watchers.emit(bundle, false)
      held.delete(bundle)
      if (own.pinnedIn && !own.pinnedIn.signal.aborted)
        own.pinnedIn.unpin(worldBundleAddress(table, url, bundle))
    },
    /** `bundle`'s read failed for good: its cells still hold it till they leave, but its roots,
     *  which can never load, leave who follows it at once. */
    failed(bundle: number) {
      const own = held.get(bundle)
      if (!own || own.failed) return
      own.failed = true
      watchers.emit(bundle, false)
    },
    /** Whether who follows the cells' bundles holds `bundle`: a cell does, its read not refused. */
    followed: (bundle: number) => held.has(bundle) && !held.get(bundle)!.failed,
    /** `cell` left: its bundles are let go, once. */
    release(cell: number) {
      const holds = cells.get(cell)
      if (!holds) return
      for (const bundle of cellBundles(cell)) counts.letGo(bundle)
      countBy(cells, cell, -1)
    },
    /** `cell`'s bundles, counted once more. */
    listed(cell: number) {
      countBy(cells, cell, 1)
      return cellBundles(cell)
    },
  }
  return counts
}

/** The queue a world's bundles are read through: bound by each session — or a world's model as it
 *  loads —, its catalogue given every bundle and page and what `kept` holds pinned in its cache;
 *  let go as it closes; a read asked while none is bound waits for the next (`next`). */
function createBinding(table: WorldRoots, url: string, kept: (session: PageQueue) => void) {
  let queue: PageQueue | undefined,
    bound = createDeferred<PageQueue>()
  /** `session` closed: a read asked from now on waits for the next one. */
  const closed = (session: PageQueue) => {
    if (queue !== session) return
    queue = undefined
    bound = createDeferred<PageQueue>()
  }
  return {
    /** The queue bound now, if open. */
    current: () => (queue?.signal.aborted ? undefined : queue),
    /** The queue bound now, else the next one bound, waited on till `signal` lets go: a closed
     *  queue is never handed out. */
    next(signal?: AbortSignal) {
      if (queue?.signal.aborted) closed(queue)
      return queue ? Promise.resolve(queue) : waited(bound.promise, signal)
    },
    /** `session` reads the bundles from now on; one already closed — its device lost before it
     *  bound — is refused. */
    bind(session: PageQueue) {
      if (queue === session || session.signal.aborted) return
      session.admit(worldPages(table, url))
      kept(session)
      queue = session
      bound.resolve(session)
      session.signal.addEventListener('abort', () => closed(session), { once: true })
    },
  }
}

/** The budget of the top cells of `table` — those whose parent is none —, `most` bytes at most,
 *  never more than all their bundles weigh — what it reserves stays what the tops can hold —, over
 *  the bundles `held`: those a top holds counted once whatever the tops sharing one (`Held.tops`),
 *  taken into the budget as a top is held (`committed`), and out of the reserve once pinned
 *  (`pinned`) — never before they are the cache's —; the tops refused counted. */
function createTopBudget(table: WorldRoots, most: number, held: ReadonlyMap<number, Held>) {
  const isTop = (cell: number) => table.chain.parent[cell] < 0
  const all = new Set<number>()
  table.hlod.forEach((bundles, cell) => {
    if (isTop(cell)) for (const bundle of bundles) all.add(bundle)
  })
  let need = 0
  for (const bundle of all) need += table.bundles[bundle].bytes
  const budget = Math.min(most, need)
  let committed = 0,
    pinned = 0,
    refused = 0
  const weight = (bundle: number) => table.bundles[bundle].bytes
  return {
    isTop,
    /** Whether the bundles of `bundles` no top holds yet fit what the budget leaves. */
    fits(bundles: readonly number[]) {
      let more = 0
      for (const bundle of bundles) if (!held.get(bundle)?.tops) more += weight(bundle)
      return committed + more <= budget
    },
    /** A top refused, by name. */
    refuse(cell: number): never {
      refused++
      throw new Error(`WORLD_TOP_BUDGET cell ${cell}: past ${budget - committed} left of ${budget}`)
    },
    /** `own`, bundle `bundle`, held by one more top. */
    take(own: Held, bundle: number) {
      if (own.tops++ > 0) return
      committed += weight(bundle)
      if (own.pinnedIn) pinned += weight(bundle)
    },
    /** `own`, bundle `bundle`, held by one top less. */
    letGo(own: Held, bundle: number) {
      if (--own.tops > 0) return
      committed -= weight(bundle)
      if (own.pinnedIn) pinned -= weight(bundle)
    },
    /** `own`, bundle `bundle`, pinned for the first time: out of the reserve if a top holds it. */
    pinned(own: Held, bundle: number) {
      if (own.tops) pinned += weight(bundle)
    },
    /** The budget, the bytes the tops hold — pinned or on their way —, and the tops refused. */
    stats: () => ({ budget, bytes: committed, refused }),
    /** What the budget leaves free of what the tops pinned: reserved off the cache's total. */
    free: () => budget - pinned,
  }
}

/** The bundles of `table`'s binary at `url` the HLOD cells hold, read through the queue each
 *  session binds (`bind`); the top cells' within `topBudget` bytes (`createTopBudget`). */
export function createWorldBundles(table: WorldRoots, url: string, topBudget = WORLD_TOP_BUDGET) {
  // Per HLOD cell, the bundles of its actor's roots: the table's own list.
  const cellBundles = (cell: number): readonly number[] => table.hlod[cell] ?? []
  const watchers = createListeners<Parameters<Watcher>>(),
    counts = createBundleCounts(table, url, watchers, cellBundles),
    { held, take, listed } = counts
  const tops = createTopBudget(table, topBudget, held)
  /** The top cells held, each counted once in the budget. */
  const topsHeld = new Set<number>()
  /** `own`, bundle `bundle` read, pinned in `session`'s cache: there alone. */
  const pinIn = (own: Held, bundle: number, session: PageQueue) => {
    if (own.pinnedIn === session || !held.has(bundle)) return
    const address = worldBundleAddress(table, url, bundle)
    if (own.pinnedIn && !own.pinnedIn.signal.aborted) own.pinnedIn.unpin(address)
    else if (!own.pinnedIn) tops.pinned(own, bundle)
    session.pin(address)
    own.pinnedIn = session
  }
  // A session that binds pins again what the holds read before it.
  const binding = createBinding(table, url, (session) => {
    for (const [bundle, own] of held) if (own.pinnedIn) pinIn(own, bundle, session)
  })
  /** The bundles of `bundles` not read yet, held as `owns`, read through `session` as `asked` and
   *  pinned there. A bundle of no bytes holds no page: nothing to read. */
  const readOn = (
    session: PageQueue,
    bundles: readonly number[],
    owns: Held[],
    asked: WorldHold,
  ) => {
    const signal = asked.signal ?? session.signal,
      priority = asked.priority ?? PRIORITY_VISIBLE
    const reads = owns.map((own, at) =>
      own.pinnedIn || table.bundles[bundles[at]].bytes === 0
        ? undefined
        : session.readBytes(worldBundleAddress(table, url, bundles[at]), signal, priority).then(
            () => pinIn(own, bundles[at], session),
            (error: unknown) => {
              // Refused for good, not let go: no read of this session would pass.
              if (!signal.aborted && !session.signal.aborted) counts.failed(bundles[at])
              throw error
            },
          ),
    )
    return Promise.all(reads)
  }
  /** What `use` reads through the queue bound now, else the next one bound, till `signal` lets
   *  go: a read its session's close stopped is asked again of the next session's queue. */
  const onBound = async <T>(
    signal: AbortSignal | undefined,
    use: (session: PageQueue) => Promise<T>,
  ) => {
    for (;;) {
      const session = await binding.next(signal)
      try {
        return await use(session)
      } catch (error) {
        if (!session.signal.aborted || signal?.aborted) throw error
      }
    }
  }
  /** The pages of `bundles`, held as `owns`, read as `asked`. */
  const read = (bundles: readonly number[], owns: Held[], asked: WorldHold) =>
    onBound(asked.signal, (session) => readOn(session, bundles, owns, asked))
  return {
    /** `cell` holds its actor's roots: their bundles are held, those neither read nor on their way
     *  read. Each hold is released once (`release`), landed or not: a hold
     *  that failed keeps its bundles wanted till then, and one whose `signal` aborted stops waiting,
     *  its bundles read on for another hold that waits on them. */
    async hold(cell: number, asked: WorldHold = {}) {
      // A top past its budget is refused before it holds anything: its release finds nothing.
      const top = tops.isTop(cell) && !topsHeld.has(cell)
      if (top && !tops.fits(cellBundles(cell))) tops.refuse(cell)
      const bundles = listed(cell),
        owns = bundles.map(take),
        priority = asked.priority ?? PRIORITY_VISIBLE
      if (top) {
        topsHeld.add(cell)
        owns.forEach((own, at) => tops.take(own, bundles[at]))
      }
      for (const own of owns) own.priority = Math.min(own.priority, priority)
      asked.signal?.throwIfAborted()
      await read(bundles, owns, asked)
    },
    /** `cell`'s bundles still on their way are lifted to `asked.priority`, when more urgent: the
     *  queue serves one read whoever asks it, the most urgent first. */
    lift(cell: number, asked: Required<WorldHold>) {
      const session = binding.current()
      for (const bundle of cellBundles(cell)) {
        const own = held.get(bundle)
        if (!own || own.failed || own.priority <= asked.priority) continue
        own.priority = asked.priority
        if (!session || own.pinnedIn || table.bundles[bundle].bytes === 0) continue
        const address = worldBundleAddress(table, url, bundle)
        session.readBytes(address, asked.signal, asked.priority).catch(() => {})
      }
    },
    /** The most urgent priority a hold asked `bundle` at: the root cover loads in that order. */
    priorityOf: (bundle: number) => held.get(bundle)?.priority ?? Infinity,
    /** `cell` let go: a bundle no held cell needs any more is let go. */
    release(cell: number) {
      if (topsHeld.delete(cell))
        for (const bundle of cellBundles(cell)) tops.letGo(held.get(bundle)!, bundle)
      counts.release(cell)
    },
    /** Whether top cell `cell`'s bundles fit the tops' budget now — held already, or room left —:
     *  what a top is held by, nearest first (`../partition/hlodCells.ts`). Any other cell fits. */
    fits: (cell: number) => !tops.isTop(cell) || topsHeld.has(cell) || tops.fits(cellBundles(cell)),
    /** The top cells' budget, the bytes they hold, and the tops refused. */
    top: tops.stats,
    /** Bytes reserved off the cache's total: what the top cells' budget leaves free — the bundles
     *  any cell holds are the cache's entries, pinned, counted there. */
    reserve: tops.free,
    /** The file `page` names — the world's DAG —, read whole through the queue bound on `signal`
     *  (`readWhole`). */
    file: (page: StreamPage, signal?: AbortSignal) =>
      onBound(signal, (session) => readWhole(session, page, signal ?? session.signal)),
    /** The bundles the cells hold now, ascending, those refused for good left out. */
    held: () => [...held.keys()].filter(counts.followed).sort((a, b) => a - b),
    /** Tells `watcher` each bundle the cells hold from now on, those held already first; returns
     *  what stops it. */
    watch(watcher: Watcher) {
      const stop = watchers.subscribe(watcher)
      for (const bundle of held.keys()) if (counts.followed(bundle)) watcher(bundle, true)
      return stop
    },
    /** The session's queue the bundles are read through: they join its catalogue, once. */
    bind: binding.bind,
  }
}
