/**
 * THE WORLD TOP, PINNED, AND THE WORLD BUNDLES A PLACED CELL'S ROOTS NEED.
 *
 * The compiler continues the DAG above every object's roots up to a small world top
 * (`world-roots.table`, docs/FORMAT.md, World super-roots), its records read straight from their
 * bytes, never one string of the whole world. The runtime pins that top alone: read at
 * open — its bundles are the binary's first, one ranged read —, each bundle checked against its
 * own digest, and held for the scene's life. Its bytes are bounded by the materials, never the
 * world (`pinnedTopBytes`, refused at cook past `budgetBytes`), so the pinned memory is the same at
 * 1 km and at 8 km.
 *
 * The object roots are not pinned: they are pages like any other, held while the view holds
 * their placements, and installed after their dependencies — the world bundles past the top their
 * roots need (`cells[].objects[].dependencies`), a lone object's copy among them, which nothing
 * above replaces and no other cell pays for. A cell the view places holds those bundles (`hold`),
 * counted once however many cells share one, and a cell that leaves releases them; a scene not
 * partitioned is one cell, placed for its whole life. The session counts every byte held here in
 * its CPU budget (`bytes`).
 */
import type { WorldPageServer } from './worldPageServe.ts'
import {
  worldBundlePages,
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
import { corruptObject, fetchVerified } from '../cluster/pages.ts'
import { verifyPageBytes } from '../page/work/host.ts'
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts'
import { families } from '../host/families.ts'
import { worldRootDag } from './worldSuperRoots.ts'
import { cellSuperRoots } from '../partition/superRoots.ts'
import { createWorldObjects } from './worldObjects.ts'
import { createHeldBundles } from './worldHeldBundles.ts'

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

/** Bundles `[first, end)` of the binary `read` reads (`rangedReader`), in one ranged request that
 *  `meter` counts, each checked against its digest, then its pages; none for an empty range, the
 *  top of a world whose objects all stand alone. */
async function readBundles(
  read: ReturnType<typeof rangedReader>,
  url: string,
  table: WorldRoots,
  [first, end]: number[],
  meter?: ByteMeter,
) {
  if (first >= end) return []
  const from = table.bundles[first].offset,
    last = table.bundles[end - 1]
  const bytes = new Uint8Array(await read(from, last.offset + last.bytes - from, meter))
  return Promise.all(
    table.bundles.slice(first, end).map(async (bundle, i) => {
      const start = bundle.offset - from
      const view = bytes.subarray(start, start + bundle.bytes)
      const sha256 = await verifyPageBytes(view)
      if (sha256 !== bundle.sha256)
        throw corruptObject(`${url}#${first + i}`, bundle, bundle.bytes, sha256)
      return worldBundlePages(table, first + i, view)
    }),
  )
}

/** The world stream of `table`, opened once on first use: the world page source over
 *  `bundlePages`, and the world DAG read from `dagFile` beside it (`undefined` without one). A
 *  family refusal is asked again on the next use, and a table out of rank refused again. */
function worldStreamOf(
  table: WorldRoots,
  bundlePages: (bundle: number) => Promise<WorldRootsPage[]>,
  dagFile: { url: string; announced?: Announced },
  signal?: AbortSignal,
) {
  let stream: WorldStream | undefined
  return async () => {
    if (stream) return stream
    const { worldPageServer, worldRootPages } = await families.worldStream.load()
    // The world DAG's file, read once the stream opens: a load never holds it.
    const { url, announced } = dagFile
    const records =
      announced && readWorldRootsDag(new Uint8Array(await fetchVerified(url, announced, signal)))
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
      source: worldPageServer(table, bundlePages, tell),
    })
  }
}

/**
 * The cache's geometry page reader `read` with the world's pages of `hold` served by its own
 * source: built once, where the engine's context is made, and the one reader every page read goes
 * through. Without a stream to draw from, `read` itself.
 */
export function worldOrGeometryReader(
  hold: WorldRootsHold | undefined,
  read: ((url: string, signal?: AbortSignal, priority?: number) => Promise<Uint8Array>) | undefined,
) {
  const world = hold?.drawn
  if (!world) return read
  return (url: string, signal?: AbortSignal, priority?: number) => {
    if (url.startsWith(`${WORLD_ROOTS_BIN}#`)) return world.source.read(url, signal)
    if (!read) return Promise.reject(new Error('Missing geometry page reader'))
    return read(url, signal, priority)
  }
}

/**
 * The world roots of the cache `metadata` describes at `base`, their top read and pinned, or
 * `undefined` for a cache that publishes none (a scene with no placed DAG, or one cooked without
 * the roots table). A partitioned world — more than one cell — opens its stream at once, its DAG
 * read: the cut packs it to draw the cells it holds far (`drawn`,
 * `../webgpu/pages/prepare/worldRoot.ts`).
 */
export async function openWorldRoots(
  metadata: ClusterManifest,
  base: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
) {
  const files = (metadata as { files?: Record<string, Announced | undefined> }).files ?? {}
  const announced = files[WORLD_ROOTS_FILE]
  if (!announced) return undefined
  const urls = worldRootsUrls(base)
  const bytes = await fetchVerified(urls.table, announced, signal, meter)
  const table = readWorldRoots(new Uint8Array(bytes))
  const url = new URL(table.payload.url, base).href
  // The load's meter counts the top, read while it loads; a cell's bundles are read after it.
  const read = rangedReader(url, signal)
  const readOne = (bundle: number) =>
    readBundles(read, url, table, [bundle, bundle + 1]).then(([pages]) => pages)
  const topBundles = await readBundles(read, url, table, [0, table.pinned], meter)
  const dag = files[WORLD_ROOTS_DAG]
  const objects = createWorldObjects(table, metadata.primitives ?? [])
  const hold = worldRootsHold(table, { read, readOne, topBundles, objects }, (bundlePages) =>
    worldStreamOf(table, bundlePages, { url: urls.dag, announced: dag }, signal),
  )
  if (table.cells.count > 1 && dag) {
    await hold.stream()
    hold.draws = true
    hold.drawnBytes = dag.bytes
  }
  // The engine whose scene is this manifest's draws from it (`EngineContext.worldRoots`).
  hold.metadata = metadata
  opened.add(hold)
  return hold
}

/** The holds `openWorldRoots` opened: what a model's record shows of one is its count alone. */
const opened = new WeakSet<object>()

/** Whether `counted` — a model's world roots as its record shows them, the bytes the session
 *  counts — is a hold `openWorldRoots` opened: the engine's own view of it. */
export const isWorldRootsHold = (counted: object): counted is WorldRootsHold => opened.has(counted)

/** A bundle's pages, read and verified. */
type BundlePages = (bundle: number) => Promise<WorldRootsPage[]>
/** What a hold reads from: the binary's ranged reader, one bundle's read, the pinned top and the
 *  objects its rows draw. */
type HoldParts = {
  read: ReturnType<typeof rangedReader>
  readOne: BundlePages
  topBundles: WorldRootsPage[][]
  objects: ReturnType<typeof createWorldObjects>
}

/** The hold of `table`: its pinned top `topBundles`, the bundles its placed cells hold, read
 *  through `readOne` on `read`, the `objects` its rows draw, and its stream, opened on first use
 *  from `streamOf`. */
function worldRootsHold(
  table: WorldRoots,
  { read, readOne, topBundles, objects }: HoldParts,
  streamOf: (bundlePages: BundlePages) => () => Promise<WorldStream>,
) {
  const rootsIn = (bundle: number) => hold.drawn?.dag?.held.get(bundle)?.length ?? 0
  const holds = createHeldBundles(table, readOne, rootsIn)
  /** A bundle's pages: the pinned top's and a placed cell's from what is held, any other read and
   *  verified for the one request (the GPU page pool keeps what it uploads). */
  const stream = streamOf((bundle) =>
    bundle < table.pinned
      ? Promise.resolve(topBundles[bundle])
      : (holds.held.get(bundle)?.pages ?? readOne(bundle)),
  )
  let opened: WorldStream | undefined
  const hold = {
    table,
    /** The world pages' source (`worldPageServe.ts`) and their DAG in the engine's own `DagRoot`
     *  shape (`undefined` without its DAG file), opened once, on first use; a table out of its
     *  rank refused here (`WORLD_CLUSTER_RANK`). `draws`: the cut packs and draws it (`drawn`), a
     *  partitioned world's, opened at load, the DAG's bytes `drawnBytes`. */
    stream: async () => (opened = await stream()),
    draws: false,
    drawnBytes: 0,
    get drawn() {
      return hold.draws ? opened : undefined
    },
    /** The manifest that opened it: an engine over that scene draws from it. */
    metadata: undefined as object | undefined,
    /** The object each placed row draws (`worldObjects.ts`). */
    objects,
    /** The pinned top: its bundles, pages and bytes, for the scene's life. */
    pinned: { bundles: table.pinned, pages: topBundles.flat(), bytes: table.pinnedTopBytes },
    /** `cell` is placed: the bundles its objects' roots need past the top are read and held,
     *  each once whatever the cells sharing it. A read that fails holds nothing of the cell. */
    hold: holds.hold,
    /** `cell` left: a bundle no placed cell needs any more is let go, and its objects read. */
    release(cell: number) {
      holds.release(cell)
      objects.release(cell)
    },
    /** The bundles past the top the placed cells hold now, ascending. */
    held: () => [...holds.held.keys()].sort((a, b) => a - b),
    /** Tells `watcher` each bundle the cells start or stop holding (`worldHeldBundles.ts`). */
    watch: holds.watch,
    /** The room the cut's cache leaves the roots held cells add, and whether a cell may be held
     *  far within it (`worldHeldBundles.ts`). */
    cover: holds.cover,
    /** Every byte held here: the pinned top's, the placed cells' bundles', the binary a server
     *  that ignores the Range answered whole (`rangedReader`), and the DAG a world draws. */
    bytes: () =>
      table.pinnedTopBytes +
      holds.bytes() +
      read.held() +
      // The source's own bundles past the top and the held ones: kept for a page in flight.
      (opened?.source.keptBytes(holds.held) ?? 0) +
      hold.drawnBytes,
  }
  return hold
}

export type WorldRootsHold = NonNullable<Awaited<ReturnType<typeof openWorldRoots>>>
