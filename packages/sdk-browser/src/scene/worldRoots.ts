/**
 * THE WORLD TOP, PINNED, AND THE WORLD BUNDLES A PLACED CELL'S ROOTS NEED.
 *
 * The compiler continues the DAG above every object's roots up to a small world top
 * (`world-roots.table`, docs/FORMAT.md, World super-roots), its records read straight from their
 * bytes, never one string of the whole world. The runtime pins that top alone: read at
 * open — its bundles are the binary's first, read end to end by one request —, each bundle checked
 * against its own digest, and held for the scene's life. Its bytes are bounded by the materials,
 * never the world (`pinnedTopBytes`, refused at cook past `budgetBytes`), so the pinned memory is
 * the same at 1 km and at 8 km.
 *
 * The object roots are not pinned: they are pages like any other, held while the view holds
 * their placements, and installed after their dependencies — the world bundles past the top their
 * roots need (`cells[].objects[].dependencies`), a lone object's copy among them, which nothing
 * above replaces and no other cell pays for. A cell the view places holds those bundles (`hold`,
 * `worldBundles.ts`), read through the queue of the session drawing it (`bind`); a scene not
 * partitioned is one cell, held from its load for its whole life. The session counts every byte
 * held here in its CPU budget (`bytes`).
 */
import type { WorldPageServer } from './worldPageServe.ts'
import {
  WORLD_ROOTS_BIN,
  WORLD_ROOTS_DAG,
  WORLD_ROOTS_FILE,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import {
  readWorldRoots,
  readWorldRootsDag,
} from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'
import { rangedReader } from '../cluster/ranged.ts'
import { fetchVerified } from '../cluster/pages.ts'
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts'
import { families } from '../host/families.ts'
import { worldRootDag } from './worldSuperRoots.ts'
import { cellSuperRoots } from '../partition/superRoots.ts'
import { createWorldBundles } from './worldBundles.ts'
import { bundlePages, readBundle, readSpan } from './worldRuns.ts'
import { createWorldObjects } from './worldObjects.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { PageQueue } from '../streaming/types.ts'
import type { PageCache } from '../streaming/pageCache.ts'

/** A reader of a file's ranges (`rangedReader`). */
type RangedRead = ReturnType<typeof rangedReader>

/** The world pages' detached source, their DAG and each cell's super-root bound, which a
 *  partition's plan reads (`partition/superRoots.ts`): a partitioned world opens them at load,
 *  the WebGPU cut drawing its far cells from them; any other reads them on first use. */
type WorldStream = {
  source: WorldPageServer
  dag: ReturnType<typeof worldRootDag>
  superRoots: Float64Array | undefined
  /** Who is told the pages a bundle read landed beside the one asked (`worldPageServer`). */
  landed: Set<(addresses: readonly string[]) => void>
}

type Announced = { bytes: number; sha256: string }
/** Where a cache keeps its world roots' table and the binary the cook writes beside it. */
const worldRootsUrls = (base: string) => ({
  table: new URL(WORLD_ROOTS_FILE, base).href,
  dag: new URL(WORLD_ROOTS_DAG, base).href,
  bin: new URL(WORLD_ROOTS_BIN, base).href,
})
/** What a load reads of the world roots `declared` lists, address to length: the table whole, and
 *  of the binary the one range it reads, the pinned top its cook published in `manifest`
 *  (`worldRoots.pinnedTopBytes`); a server that ignores the Range adds the rest as it arrives. */
export function worldRootsPlan(
  declared: ReadonlyMap<string, number>,
  base: string,
  manifest: object,
) {
  const { table, bin } = worldRootsUrls(base)
  const top = (manifest as { worldRoots?: { pinnedTopBytes?: number } }).worldRoots?.pinnedTopBytes
  const plan: [string, number][] = []
  if (declared.has(table)) plan.push([table, declared.get(table)!])
  if (declared.has(bin) && top) plan.push([bin, top])
  return plan
}

/** The world stream of `table`, opened on first use — `dag` its DAG file, read at `dagUrl` then,
 *  `pages` each bundle's —: only an opened stream is kept, so a family refusal is asked again on the
 *  next use (`onDemand`), and a table out of rank is refused again, before any page is served. */
function worldStream(
  table: WorldRoots,
  dag: Announced | undefined,
  dagUrl: string,
  signal: AbortSignal | undefined,
  pages: (bundle: number, signal: AbortSignal, priority?: number) => Promise<WorldRootsPage[]>,
) {
  let stream: WorldStream | undefined
  const open = async () => {
    if (stream) return stream
    const { worldPageServer, worldRootPages } = await families.worldStream.load()
    const records =
      dag && readWorldRootsDag(new Uint8Array(await fetchVerified(dagUrl, dag, signal)))
    const landed = new Set<(addresses: readonly string[]) => void>()
    const tell = (addresses: readonly string[]) => landed.forEach((watcher) => watcher(addresses))
    return (stream ??= {
      landed,
      dag: worldRootDag(
        { ...records, payload: table.payload, pinned: table.pinned },
        worldRootPages,
      ),
      // An object root's cell is its object's (`origin`, the table's rank).
      superRoots:
        records && cellSuperRoots(records.clusters, table.cells.cellOf, table.cells.count),
      source: worldPageServer(table, pages, tell),
    })
  }
  return {
    open,
    keptBytes: (held: { has(bundle: number): boolean }) => stream?.source.keptBytes(held) ?? 0,
  }
}

/** What a load reads the world roots through: the session's queue it loads for, else the page
 *  cache of the world its model loads for, whose one reader of the binary every session shares. */
export type WorldRead = { queue?: PageQueue; cache?: PageCache }

/** The pinned top of `table`'s binary at `url`, read for a load on `signal`: through `queue`, its
 *  bundles admitted as pages, else in one range by `read` that `meter` counts. */
function readTop(
  table: WorldRoots,
  url: string,
  signal: AbortSignal | undefined,
  { queue, read, meter }: { queue?: PageQueue; read: () => RangedRead; meter: ByteMeter },
) {
  if (!queue) return readSpan(read(), url, table, [0, table.pinned], { meter, signal })
  queue.admit(bundlePages(table, url))
  const tops = Array.from({ length: table.pinned }, (_, bundle) =>
    readBundle(queue, table, url, bundle, signal ?? queue.signal, PRIORITY_VISIBLE),
  )
  return Promise.all(tops)
}

/**
 * The cache's geometry page reader `read` with the world's pages of `hold` served by its own
 * source: built once, where the engine's context is made, and the one reader every page read goes
 * through. Both kinds of page are read under the reader's own signal, else `session`'s — a read
 * never outlives its session —, at the caller's priority.
 */
export function worldOrGeometryReader(
  hold: WorldRootsHold | undefined,
  read: (url: string, signal: AbortSignal, priority?: number) => Promise<Uint8Array>,
  session: AbortSignal,
) {
  const world = hold?.drawn
  return (url: string, own?: AbortSignal, priority?: number) => {
    const signal = own ?? session
    if (world && url.startsWith(`${WORLD_ROOTS_BIN}#`))
      return world.source.read(url, signal, priority)
    return read(url, signal, priority)
  }
}

/**
 * The world roots of the cache `metadata` describes at `base`, their top read and pinned — with
 * the one cell of a scene not partitioned (`whole`), held for its life —, or `undefined` for a
 * cache that publishes none (a scene with no placed DAG, or one cooked without the roots table).
 * A session's load reads them through its queue (`through.queue`), the bundles bound to it; a
 * world's model, before any session, by the one reader of the binary its page cache holds. A
 * partitioned world — more than one cell — opens its stream at once, its DAG read: the cut packs
 * it to draw the cells it holds far (`drawn`, `../webgpu/pages/prepare/worldRoot.ts`).
 */
export async function openWorldRoots(
  metadata: ClusterManifest,
  base: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
  whole = false,
  through: WorldRead = {},
) {
  const files = (metadata as { files?: Record<string, Announced | undefined> }).files ?? {}
  const announced = files[WORLD_ROOTS_FILE]
  if (!announced) return undefined
  const urls = worldRootsUrls(base)
  const bytes = await fetchVerified(urls.table, announced, signal, meter)
  const table = readWorldRoots(new Uint8Array(bytes))
  const url = new URL(table.payload.url, base).href
  const { queue, cache } = through
  const read = () => cache?.reader(url) ?? rangedReader(url, signal)
  const top = await readTop(table, url, signal, { queue, read, meter })
  // The roots a held bundle carries for its cell join the cut's cache cover with it.
  const rootsIn = (bundle: number) => roots.drawn?.dag?.held.get(bundle)?.length ?? 0
  const bundles = createWorldBundles(table, url, top, rootsIn)
  if (queue) bundles.bind(queue)
  if (whole && queue) await bundles.hold(0, { signal })
  else if (whole) {
    const own = read()
    await bundles.keep(0, (span) => readSpan(own, url, table, span, { meter, signal }))
  }
  const dag = files[WORLD_ROOTS_DAG]
  const stream = worldStream(table, dag, urls.dag, signal, bundles.pages)
  const objects = createWorldObjects(table, metadata.primitives ?? [])
  const roots = worldRootsHold(table, top, { bundles, stream, objects })
  if (table.cells.count > 1 && dag) {
    await roots.stream()
    roots.drawnBytes = dag.bytes
  }
  // The engine whose scene is this manifest's draws from it (`EngineContext.worldRoots`).
  roots.metadata = metadata
  opened.set(roots, roots)
  return roots
}

/** What a hold reads from: the bundles its cells hold, its stream, the objects its rows draw. */
type HoldParts = {
  bundles: ReturnType<typeof createWorldBundles>
  stream: ReturnType<typeof worldStream>
  objects: ReturnType<typeof createWorldObjects>
}

/** The hold of `table`, its pinned top `top`, over its `bundles`, its `stream` and the `objects`
 *  its rows draw. */
function worldRootsHold(table: WorldRoots, top: WorldRootsPage[][], parts: HoldParts) {
  const { bundles, stream, objects } = parts
  let streamed: WorldStream | undefined
  const roots = {
    table,
    /** The world pages' source (`worldPageServe.ts`) and their DAG in the engine's own `DagRoot`
     *  shape (`undefined` without its DAG file), opened once, on first use; a table out of its
     *  rank refused here (`WORLD_CLUSTER_RANK`). `drawn`: the cut packs and draws it, a
     *  partitioned world's, opened at load, the DAG's bytes `drawnBytes`. */
    stream: async () => (streamed = await stream.open()),
    drawnBytes: 0,
    get drawn() {
      return roots.drawnBytes > 0 ? streamed : undefined
    },
    /** The manifest that opened it: an engine over that scene draws from it. */
    metadata: undefined as object | undefined,
    /** The object each placed row draws (`worldObjects.ts`). */
    objects,
    /** The pinned top: its bundles, pages and bytes, for the scene's life. */
    pinned: { bundles: table.pinned, pages: top.flat(), bytes: table.pinnedTopBytes },
    hold: bundles.hold,
    /** `cell` left: a bundle no placed cell needs any more is let go, and its objects read. */
    release(cell: number) {
      bundles.release(cell)
    },
    has: bundles.has,
    /** The bundles past the top the placed cells hold now, ascending. */
    held: bundles.held,
    /** Tells a watcher each bundle the cells start or stop holding (`worldBundles.ts`). */
    watch: bundles.watch,
    /** The room the cut's cache leaves the roots held cells add, and whether a cell may be held
     *  far within it (`worldCoverShare.ts`). */
    cover: bundles.cover,
    /** The session's queue the bundles are read through, bound by each session. */
    bind: bundles.bind,
    /** Every byte held here: the pinned top's, the placed cells' bundles', the bundles the source
     *  keeps for a page in flight, and the DAG a world draws. */
    bytes: () =>
      table.pinnedTopBytes + bundles.bytes() + stream.keptBytes(bundles) + roots.drawnBytes,
  }
  return roots
}

export type WorldRootsHold = NonNullable<Awaited<ReturnType<typeof openWorldRoots>>>

/** Each world roots a load opened, by the object a scene's public record shows of it — its pinned
 *  top and bytes alone (`ExplorerScene.worldRoots`): the engine's stream, holds and binding stay
 *  off the public surface. */
const opened = new WeakMap<object, WorldRootsHold>()

/** The world roots `shown` shows in a scene's record, to bind to a session's queue. */
export const worldRootsOf = (shown: object) => opened.get(shown)
