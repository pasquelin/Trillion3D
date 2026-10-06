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
 * roots need (`cells[].objects[].dependencies`). A cell the view places holds those bundles
 * (`hold`, `worldBundles.ts`), read through the queue of the session drawing it (`bind`); a scene
 * not partitioned is one cell, read with the top and held for its whole life. The session counts
 * every byte held here in its CPU budget (`bytes`).
 */
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
import { worldRootsPageSource } from './worldRootsPage.ts'
import { worldRootDag } from './worldSuperRoots.ts'
import { cellSuperRoots } from '../partition/superRoots.ts'
import { createWorldBundles } from './worldBundles.ts'
import { readSpan } from './worldRuns.ts'

/** The world pages' detached source, their DAG and each cell's super-root bound, which a
 *  partition's plan reads (`partition/superRoots.ts`): nothing draws from them yet,
 *  so a scene opens without them, and their page server and DAG file are read on first use. */
type WorldStream = {
  source: ReturnType<typeof worldRootsPageSource>
  dag: ReturnType<typeof worldRootDag>
  superRoots: Float64Array | undefined
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
  pages: (bundle: number) => Promise<WorldRootsPage[]>,
) {
  let stream: WorldStream | undefined
  const open = async () => {
    if (stream) return stream
    const { worldPageServer, worldRootPages } = await families.worldStream.load()
    const records =
      dag && readWorldRootsDag(new Uint8Array(await fetchVerified(dagUrl, dag, signal)))
    return (stream ??= {
      dag: worldRootDag({ ...records, payload: table.payload }, worldRootPages),
      // An object root's cell is its object's (`origin`, the table's rank).
      superRoots:
        records && cellSuperRoots(records.clusters, table.cells.cellOf, table.cells.count),
      source: worldRootsPageSource(worldPageServer(table, pages)),
    })
  }
  return {
    open,
    keptBytes: (held: { has(bundle: number): boolean }) => stream?.source.keptBytes(held) ?? 0,
  }
}

/**
 * The world roots of the cache `metadata` describes at `base`, their top read and pinned — with
 * the one cell of a scene not partitioned (`whole`) —, or `undefined` for a cache that publishes
 * none (a scene with no placed DAG, or one cooked without the roots table).
 */
export async function openWorldRoots(
  metadata: ClusterManifest,
  base: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
  whole = false,
) {
  const files = (metadata as { files?: Record<string, Announced | undefined> }).files ?? {}
  const announced = files[WORLD_ROOTS_FILE]
  if (!announced) return undefined
  const urls = worldRootsUrls(base)
  const bytes = await fetchVerified(urls.table, announced, signal, meter)
  const table = readWorldRoots(new Uint8Array(bytes))
  const url = new URL(table.payload.url, base).href
  // The load's meter counts the top, read while it loads, and a scene's one cell, held for its life.
  const read = rangedReader(url, signal)
  const top = await readSpan(read, url, table, [0, table.pinned], meter)
  const bundles = createWorldBundles(table, url, top)
  if (whole) await bundles.keep(0, (span) => readSpan(read, url, table, span, meter))
  const stream = worldStream(table, files[WORLD_ROOTS_DAG], urls.dag, signal, bundles.pages)
  return {
    table,
    /** The world pages' detached source, both engines' shape (`worldRootsPage.ts`), and their DAG
     *  in the engine's own `DagRoot` shape from the cook's rank order (`undefined` for a cache
     *  without its DAG file), opened once, on first use. A table out of its
     *  rank is refused here (`WORLD_CLUSTER_RANK`), before any page is drawn from it. */
    stream: stream.open,
    /** The pinned top: its bundles, pages and bytes, for the scene's life. */
    pinned: { bundles: table.pinned, pages: top.flat(), bytes: table.pinnedTopBytes },
    hold: bundles.hold,
    release: bundles.release,
    held: bundles.held,
    bind: bundles.bind,
    /** Every byte held here: the pinned top's, the placed cells' bundles', and the whole binary a
     *  server that ignores the Range answered (`rangedReader`). */
    bytes: () =>
      table.pinnedTopBytes +
      bundles.bytes() +
      read.held() +
      // The source's own bundles past the top and the held ones: kept for a page's other view.
      stream.keptBytes(bundles),
  }
}

export type WorldRootsHold = NonNullable<Awaited<ReturnType<typeof openWorldRoots>>>
