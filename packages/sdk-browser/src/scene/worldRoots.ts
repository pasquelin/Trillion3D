/**
 * THE WORLD'S HLOD: ITS TABLE, ITS DAG, AND THE BUNDLES ITS HLOD CELLS HOLD.
 *
 * The compiler builds the world's HLOD chain, HLOD 1 to 3 (`world-roots.table`,
 * docs/FORMAT.md, World HLOD), its records read straight from their bytes, never one string of the
 * whole world. Nothing is held for good: an HLOD cell holds the bundles of its actor's roots — pinned
 * in the session's page cache — while its actor is loaded, and lets them go when it leaves
 * (`hold`, `worldBundles.ts`, `../partition/hlodCells.ts`), read through the
 * queue of the session drawing it (`bind`): an HLOD actor streams with its own grid's cell, so its
 * pages follow that cell's range; a top cell's, always loaded, within the tops' own budget. A partitioned world opens its DAG at load: the cut packs it as its
 * last root (`dag`, `../webgpu/pages/prepare/worldRoot.ts`), since every spatially loaded cell has
 * its HLOD built and something must stand in for a cell before its own pages land. Every read — the table and the DAG whole, the bundles as pages — goes through one page
 * queue: the session's its load reads for, or — a world's model, before any session — one of its
 * own over the world's page cache; the table and the DAG are read for their decode alone, never
 * kept there (`readWhole`). The session reserves off its CPU budget the DAG and what the tops'
 * budget leaves free (`reserved`): the bundles held are the page cache's entries, counted there.
 */
import {
  WORLD_ROOTS_DAG,
  WORLD_ROOTS_FILE,
  type WorldRoots,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import {
  readWorldRoots,
  readWorldRootsDag,
} from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import type { PageSurface } from '../page/surface.ts'
import { families } from '../host/families.ts'
import { worldRootDag } from './worldHlod.ts'
import { createWorldBundles } from './worldBundles.ts'
import { readWhole } from './worldRuns.ts'
import type { PlacementRows } from '../placement/rows.ts'
import type { PageQueue, StreamPage } from '../streaming/types.ts'

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

/** The world DAG of `table`, its binary at the resolved `url`, its DAG file `dag` read whole by
 *  `read`, in the engine's own `DagRoot` shape (`worldRootDag`). */
async function openDag(
  table: WorldRoots,
  url: string,
  dag: StreamPage,
  read: (page: StreamPage) => Promise<Uint8Array>,
) {
  const { worldRootPages } = await families.worldStream.load()
  const records = readWorldRootsDag(await read(dag))
  return worldRootDag(
    { ...records, url, chain: table.chain, bundles: table.bundles },
    worldRootPages,
  )
}

/**
 * The world's HLOD of the cache `metadata` describes at `base`, its DAG read when published, or
 * `undefined` for a cache that publishes none (a scene with no placed DAG, or one cooked without
 * it). Its table, its DAG and its bundles are read through `queue`, bound to it: a session's load
 * reads through the session's, a world's model through one of its own over its world's page cache.
 */
export async function openWorldRoots(
  metadata: ClusterManifest,
  base: string,
  queue: PageQueue,
  { signal }: { signal?: AbortSignal } = {},
) {
  const files = (metadata as { files?: Record<string, Announced | undefined> }).files ?? {}
  const tableFile = announcedFile(files, WORLD_ROOTS_FILE, base)
  const dagFile = announcedFile(files, WORLD_ROOTS_DAG, base)
  if (!tableFile) return undefined
  const table = readWorldRoots(await readWhole(queue, tableFile, signal ?? queue.signal))
  const url = new URL(table.payload.url, base).href
  const bundles = createWorldBundles(table, url)
  // Bound first: the queue's catalogue takes every bundle and page once.
  bundles.bind(queue)
  const dag = dagFile && (await openDag(table, url, dagFile, (page) => bundles.file(page, signal)))
  return worldRootsHold(table, bundles, dag, dag ? dagFile.bytes : 0)
}

/** The hold of `table` over its `bundles` and its DAG `dag`, of `dagBytes`. */
function worldRootsHold(
  table: WorldRoots,
  bundles: ReturnType<typeof createWorldBundles>,
  dag: Awaited<ReturnType<typeof openDag>>,
  dagBytes: number,
) {
  let posed: { readonly rows: PlacementRows } | undefined,
    worn: readonly PageSurface[] = []
  return {
    table,
    /** The world DAG the cut packs and draws (`undefined` for a DAG of no cluster). */
    dag,
    /** Each actor's flattened material, by the rank its clusters name: the scene's surfaces of
     *  the tables' `hlodMaterials` (`wear`), none before the scene that opened it is built. */
    get surfaces() {
      return worn
    },
    /** The actors wear `surfaces`, built from the scene tables with the scene's own materials. */
    wear(surfaces: readonly PageSurface[]) {
      worn = surfaces
    },
    /** The rows that pose the world DAG: one per placement of its model, each its world — the
     *  rows the poses hold now, grown with the model's sources. Absent, the DAG stands at the
     *  scene's origin, as a scene opened alone does. */
    get pose() {
      return posed?.rows
    },
    /** The session draws the table as `draw` says: the model that holds it is placed in the world
     *  (`pose`, a row per placement). */
    drawnAs(draw: { pose?: { readonly rows: PlacementRows } }) {
      posed = draw.pose
    },
    /** HLOD cell `cell` holds its actor's roots (`worldBundles.ts`). */
    hold: bundles.hold,
    /** `cell` let go: a bundle no held cell needs any more is let go. */
    release: bundles.release,
    /** `cell`'s bundles still on their way lifted to a more urgent priority (`worldBundles.ts`). */
    lift: bundles.lift,
    /** The most urgent priority a hold asked a bundle at (`worldBundles.ts`). */
    priorityOf: bundles.priorityOf,
    /** The bundles the cells hold now, ascending. */
    held: bundles.held,
    /** Tells a watcher each bundle the cells start or stop holding (`worldBundles.ts`). */
    watch: bundles.watch,
    /** The session's queue the bundles are read through, bound by each session. */
    bind: bundles.bind,
    /** What the session reserves off the page cache's total for it: the DAG, and what the top
     *  cells' budget leaves free (`worldBundles.ts`) — the bundles held are the cache's own
     *  entries, never counted twice. */
    reserved: () => bundles.reserve() + dagBytes,
    /** The top cells' budget, the bytes they hold, and the tops refused (`worldBundles.ts`). */
    top: bundles.top,
    /** Whether top cell `cell`'s bundles fit the tops' budget now (`worldBundles.ts`). */
    fits: bundles.fits,
  }
}

export type WorldRootsHold = NonNullable<Awaited<ReturnType<typeof openWorldRoots>>>
