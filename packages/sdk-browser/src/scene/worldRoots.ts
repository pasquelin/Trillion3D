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
 * roots need (`cellDependencies`), a lone object's copy among them, which nothing
 * above replaces and no other cell pays for. A cell the view places holds those bundles (`hold`,
 * `worldBundles.ts`), read through the queue of the session drawing it (`bind`); a scene not
 * partitioned is one cell, held from its load for its whole life. Every read of the roots — their
 * table and DAG whole, their bundles as pages — goes through one page queue: the session's its
 * load reads for, or — a world's model, before any session — one of its own over the world's page
 * cache; the table and the DAG are read for their decode alone, never kept there (`readWhole`).
 * The session counts every byte held here in its CPU budget (`bytes`).
 */
import type { WorldPageServer } from './worldPageServe.ts'
import {
  WORLD_ROOTS_DAG,
  WORLD_ROOTS_FILE,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import {
  readWorldRoots,
  readWorldRootsDag,
} from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import type { ClusterManifest, Primitive } from '../../../sdk-core/src/index.ts'
import { families } from '../host/families.ts'
import { worldRootDag } from './worldSuperRoots.ts'
import { cellSuperRoots } from '../partition/superRoots.ts'
import { createWorldBundles } from './worldBundles.ts'
import { bundlePages, readBundle, readWhole } from './worldRuns.ts'
import { createWorldObjects } from './worldObjects.ts'
import type { PlacementRows } from '../placement/rows.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { PageQueue, StreamPage } from '../streaming/types.ts'
import { createListeners, type Listeners } from '../../../sdk-core/src/runtime/listeners.ts'

/** The world pages' detached source, their DAG and each cell's super-root bound, which a
 *  partition's plan reads (`partition/superRoots.ts`): a partitioned world opens them at load,
 *  the WebGPU cut drawing its far cells from them; any other reads them on first use. */
type WorldStream = {
  source: WorldPageServer
  dag: ReturnType<typeof worldRootDag>
  superRoots: Float64Array | undefined
  /** Who is told the pages a bundle read landed beside the one asked (`worldPageServer`). */
  landed: Listeners<[addresses: readonly string[]]>
}

type Announced = { bytes: number; sha256: string }
/** The file `name` of the cache at `base` its manifest `files` announce, as the page a queue reads
 *  it whole by (`readWhole`); `undefined` for one it does not announce. */
function announcedFile(
  files: Record<string, Announced | undefined>,
  name: string,
  base: string,
): StreamPage | undefined {
  const announced = files[name]
  return announced && { url: new URL(name, base).href, ...announced }
}

/** The world stream of `table`, opened on first use — `dag` its DAG file, read whole then by
 *  `read`, `pages` each bundle's —: only an opened stream is kept, so a family refusal is asked
 *  again on the next use (`onDemand`), and a table out of rank is refused again, before any page
 *  is served. */
function worldStream(
  table: WorldRoots,
  dag: StreamPage | undefined,
  read: (page: StreamPage) => Promise<Uint8Array>,
  pages: (bundle: number, signal: AbortSignal, priority?: number) => Promise<WorldRootsPage[]>,
) {
  let stream: WorldStream | undefined
  const open = async () => {
    if (stream) return stream
    const { worldPageServer, worldRootPages } = await families.worldStream.load()
    const records = dag && readWorldRootsDag(await read(dag))
    const landed = createListeners<[addresses: readonly string[]]>()
    return (stream ??= {
      landed,
      dag: worldRootDag(
        { ...records, payload: table.payload, pinned: table.pinned },
        worldRootPages,
      ),
      // An object root's cell is its object's (`origin`, the table's rank).
      superRoots:
        records && cellSuperRoots(records.clusters, table.cells.cellOf, table.cells.count),
      source: worldPageServer(table, pages, landed.emit),
    })
  }
  return {
    open,
    keptBytes: (held: { has(bundle: number): boolean }) => stream?.source.keptBytes(held) ?? 0,
  }
}

/** The pinned top of `table`'s binary at `url`, read for a load on `signal` through `queue`, its
 *  bundles admitted as pages. */
function readTop(
  table: WorldRoots,
  url: string,
  signal: AbortSignal | undefined,
  queue: PageQueue,
) {
  queue.admit(bundlePages(table, url))
  const tops = Array.from({ length: table.pinned }, (_, bundle) =>
    readBundle(queue, table, url, bundle, signal ?? queue.signal, PRIORITY_VISIBLE),
  )
  return Promise.all(tops)
}

/**
 * The cache's geometry page reader `read` with the world's pages of `holds` — the list a session
 * keeps, whose models join it while it runs — served by their own source, which names the addresses
 * it serves (`WorldPageServer.serves`): built once, where the engine's context is made, and the one
 * reader every page read goes through. Both kinds of page are
 * read under the reader's own signal, else `session`'s — a read never outlives its session —, at
 * the caller's priority.
 */
export function worldOrGeometryReader(
  holds: readonly WorldRootsHold[],
  read: (url: string, signal: AbortSignal, priority?: number) => Promise<Uint8Array>,
  session: AbortSignal,
) {
  return (url: string, own?: AbortSignal, priority?: number) => {
    const signal = own ?? session
    for (const { drawn } of holds)
      if (drawn?.source.serves(url)) return drawn.source.read(url, signal, priority)
    return read(url, signal, priority)
  }
}

/** How a load opens the world roots: the signal that lets it go, and `whole` for a scene not
 *  partitioned. */
type WorldOpening = { signal?: AbortSignal; whole?: boolean }

/**
 * The world roots of the cache `metadata` describes at `base`, their top read and pinned — with
 * the one cell of a scene not partitioned (`whole`), held for its life —, or `undefined` for a
 * cache that publishes none (a scene with no placed DAG, or one cooked without the roots table).
 * Their table, their DAG and their bundles are read through `queue`, bound to it: a session's load
 * reads through the session's, a world's model through one of its own over its world's page cache.
 * A partitioned world — more than one cell — opens its stream at once, its DAG read: the cut packs
 * it to draw the cells it holds far (`drawn`, `../webgpu/pages/prepare/worldRoot.ts`).
 */
export async function openWorldRoots(
  metadata: ClusterManifest,
  base: string,
  queue: PageQueue,
  { signal, whole = false }: WorldOpening = {},
) {
  const files = (metadata as { files?: Record<string, Announced | undefined> }).files ?? {}
  const tableFile = announcedFile(files, WORLD_ROOTS_FILE, base)
  if (!tableFile) return undefined
  const table = readWorldRoots(await readWhole(queue, tableFile, signal ?? queue.signal))
  const url = new URL(table.payload.url, base).href
  const top = await readTop(table, url, signal, queue)
  // The roots a held bundle carries for its cell join the cut's cache cover with it.
  const rootsIn = (bundle: number) => roots.drawn?.dag?.held.get(bundle)?.length ?? 0
  const bundles = createWorldBundles(table, url, top, rootsIn)
  bundles.bind(queue)
  if (whole) await bundles.hold(0, { signal })
  const dag = announcedFile(files, WORLD_ROOTS_DAG, base)
  const stream = worldStream(table, dag, (page) => bundles.file(page, signal), bundles.pages)
  const roots = worldRootsHold(table, top, {
    bundles,
    stream,
    primitives: metadata.primitives ?? [],
  })
  if (table.cells.count > 1 && dag) {
    await roots.stream()
    roots.drawnBytes = dag.bytes
  }
  return roots
}

/** What a hold reads from: the bundles its cells hold, its stream, the objects its rows draw. */
type HoldParts = {
  bundles: ReturnType<typeof createWorldBundles>
  stream: ReturnType<typeof worldStream>
  primitives: readonly Primitive[]
}

/** The hold of `table`, its pinned top `top`, over its `bundles`, its `stream` and the objects
 *  its rows draw, the table's primitive ranks named by `primitives`. */
function worldRootsHold(table: WorldRoots, top: WorldRootsPage[][], parts: HoldParts) {
  const { bundles, stream } = parts
  let streamed: WorldStream | undefined,
    ranked = parts.primitives,
    posed: PlacementRows | undefined,
    objects = createWorldObjects(table, ranked)
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
    /** The primitives the table's ranks name, as the session that draws it ranks them: the
     *  manifest's that opened it, else those the owner of a merged manifest gave (`drawnAs`). */
    get primitives() {
      return ranked
    },
    /** The row that poses the world DAG: its model's world. Absent, the DAG stands at the
     *  scene's origin, as a scene opened alone does. */
    get pose() {
      return posed
    },
    /** The session draws the table as `draw` says — a world merges its models' manifests, so a
     *  primitive's mesh rank moves where the table's does not (`primitives`, in the table's order),
     *  and the model that holds the table is moved in the world (`pose`, one row). */
    drawnAs(draw: { primitives: readonly Primitive[]; pose?: PlacementRows }) {
      ranked = draw.primitives
      posed = draw.pose
      objects = createWorldObjects(table, ranked)
    },
    /** The object each placed row draws (`worldObjects.ts`). */
    get objects() {
      return objects
    },
    /** The pinned top: its bundles, pages and bytes, for the scene's life. */
    pinned: { bundles: table.pinned, pages: top.flat(), bytes: table.pinnedTopBytes },
    hold: bundles.hold,
    /** `cell` left: a bundle no placed cell needs any more is let go, and its objects read. */
    release: bundles.release,
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
