/**
 * THE WORLD BUNDLES PAST THE PINNED TOP THE PLACED CELLS HOLD, READ THROUGH THE SESSION'S QUEUE.
 *
 * A placed cell holds the bundles its objects' roots need (`cellDependencies`), each counted once
 * whatever the cells sharing it, and lets them go when it leaves. Those neither held nor on their
 * way are read in runs: a cell's bundles contiguous in the binary are one ranged request, a page of
 * the session's one read queue (`worldRuns.ts`), asked at the priority its cell holds with — after
 * the view's own pages, nearer first, the prefetch ring last (`holdPriority`) —, so no more than
 * the queue's transfers are in flight whatever the cells in reach. Each hold joins the read of every
 * run its bundles wait on with its own signal: a bundle on its way is shared, never read twice,
 * and the queue drops a run unread once every hold waiting on it let go. A failed run waits its
 * turn in the queue, which refuses it at once meanwhile (`../streaming/failures.ts`).
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
import { bundleIn, runPage } from './worldRuns.ts'

/** A run of bundles `[first, end)` read as one page of the queue, at `url`, and whether it landed. */
type Run = { first: number; end: number; url: string; landed: boolean }
/** A bundle a cell holds: how many cells, its pages once read, the run reading them till then. */
type Held = { cells: number; pages?: WorldRootsPage[]; run?: Run }
/** How a cell holds: the read priority of its runs, and the signal that lets its hold go. */
type WorldHold = { signal?: AbortSignal; priority?: number }

/** The end of the run of `bundles` from `at`: those after it contiguous in the binary and
 *  `wanted`. */
function runEnd(bundles: readonly number[], at: number, wanted: (at: number) => boolean) {
  let end = at + 1
  while (end < bundles.length && bundles[end] === bundles[end - 1] + 1 && wanted(end)) end++
  return end
}

/** The runs of `table`'s binary at `url` read through the session's queue (`bind`), each viewed,
 *  as it lands, on the bundles of `held` still waiting on it. */
function createRuns(table: WorldRoots, url: string, held: Map<number, Held>) {
  let queue: PageQueue | undefined
  /** The session's queue: a cell holds only within a session, which binds it first. */
  const bound = () => {
    if (!queue) throw new Error('WORLD_ROOTS_UNBOUND: a cell holds within a session')
    return queue
  }
  /** Bundles `[first, end)`, a page of the queue. */
  const run = (first: number, end: number): Run => {
    const page = runPage(table, url, first, end)
    bound().admit([page])
    return { first, end, url: page.url, landed: false }
  }
  /** `own` read for whoever asks at `priority`, with the `signal` that lets the asker go: the
   *  first to land views each bundle still held on it on the bytes. */
  const land = async (own: Run, signal?: AbortSignal, priority = PRIORITY_VISIBLE) => {
    const queue = bound(),
      bytes = await queue.readBytes(own.url, signal, priority)
    if (own.landed) return bytes
    own.landed = true
    queue.forget([own.url])
    for (let bundle = own.first; bundle < own.end; bundle++) {
      const waiting = held.get(bundle)
      if (waiting?.run !== own) continue
      waiting.pages = bundleIn(bytes, table, own.first, bundle)
      waiting.run = undefined
    }
    return bytes
  }
  return {
    run,
    land,
    /** The pages of `bundles`, held as `owns`, read as `asked`: each run of those neither read nor
     *  on their way, contiguous in the binary, a page of the queue, and every run they wait on
     *  joined. */
    async read(bundles: readonly number[], owns: readonly Held[], asked: WorldHold) {
      const unread = (at: number) => !owns[at].pages && !owns[at].run
      for (let at = 0, end = 0; at < bundles.length; at = Math.max(at + 1, end)) {
        if (!unread(at)) continue
        end = runEnd(bundles, at, unread)
        const own = run(bundles[at], bundles[end - 1] + 1)
        for (let i = at; i < end; i++) owns[i].run = own
      }
      const waits = new Set<Run>()
      for (const own of owns) if (own.run) waits.add(own.run)
      await Promise.all([...waits].map((own) => land(own, asked.signal, asked.priority)))
    },
    /** No held bundle waits on `own`'s page any more: it leaves the catalogue, with its failure if
     *  it failed. */
    forsake(own: Run) {
      for (let bundle = own.first; bundle < own.end; bundle++)
        if (held.get(bundle)?.run?.url === own.url) return
      queue?.forget([own.url])
    },
    bind(session: PageQueue) {
      queue = session
    },
  }
}

/** `bundle`'s pages read through `runs` for one request alone, at the view's priority: its page
 *  leaves the catalogue once read, landed or failed (the GPU page pool keeps what it uploads). */
async function readAlone(runs: ReturnType<typeof createRuns>, table: WorldRoots, bundle: number) {
  const own = runs.run(bundle, bundle + 1)
  try {
    return bundleIn(await runs.land(own), table, bundle, bundle)
  } finally {
    runs.forsake(own)
  }
}

/** A read of bundles `[first, end)` at open: their pages, bundle by bundle. */
type SpanRead = (span: [number, number]) => Promise<WorldRootsPage[][]>

/** The pages of `bundles`, held as `owns`, read at open in their contiguous runs by `read`. */
async function readAtOpen(bundles: readonly number[], owns: readonly Held[], read: SpanRead) {
  for (let at = 0; at < bundles.length;) {
    const end = runEnd(bundles, at, () => true)
    const pages = await read([bundles[at], bundles[end - 1] + 1])
    pages.forEach((own, i) => (owns[at + i].pages = own))
    at = end
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
    if (own.run && !own.run.landed) runs.forsake(own.run)
  }
  return {
    /** `cell` is placed: the bundles its objects' roots need past the top are held, those neither
     *  read nor on their way read. Each hold is released once (`release`), landed or not: a hold
     *  that failed keeps its bundles wanted, so their failed reads wait their turn and are asked
     *  again by the same pages, and one whose `signal` aborted lets the queue drop its reads. */
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
    /** A bundle's pages: the pinned top's or a held one's, joining the run on its way, else read
     *  for the one request alone (`readAlone`). */
    async pages(bundle: number) {
      if (bundle < table.pinned) return top[bundle]
      const own = held.get(bundle),
        run = own?.run
      if (own?.pages) return own.pages
      if (!run) return readAlone(runs, table, bundle)
      return bundleIn(await runs.land(run), table, run.first, bundle)
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
