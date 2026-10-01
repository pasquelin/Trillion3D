/**
 * THE WORLD TOP, PINNED, AND THE WORLD BUNDLES A PLACED CELL'S ROOTS NEED (#1237).
 *
 * The compiler continues the DAG above every object's roots up to a small world top
 * (`world-roots.table`, docs/FORMAT.md, World super-roots), its records read straight from their
 * bytes (#1232), never one string of the whole world. The runtime pins that top alone: read at
 * open — its bundles are the binary's first, one ranged read —, each bundle checked against its
 * own digest, and held for the scene's life. Its bytes are bounded by the materials, never the
 * world (`pinnedTopBytes`, refused at cook past `budgetBytes`), so the pinned memory is the same at
 * 1 km and at 8 km.
 *
 * The object roots are no longer pinned: they are pages like any other, held while the view holds
 * their placements, and installed after their dependencies — the world bundles past the top their
 * roots need (`cells[].objects[].dependencies`). A cell the view places holds those bundles
 * (`hold`), counted once however many cells share one, and a cell that leaves releases them; a
 * scene not partitioned is one cell, placed for its whole life. The session counts every byte held
 * here in its CPU budget (`bytes`).
 */
import {
  cellDependencies,
  worldBundlePages,
  WORLD_ROOTS_BIN,
  WORLD_ROOTS_DAG,
  WORLD_ROOTS_FILE,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts';
import {
  readWorldRoots,
  readWorldRootsDag,
} from '../../../sdk-core/src/manifest/worldRootsTable.ts';
import type { ClusterManifest } from '../../../sdk-core/src/index.ts';
import { rangedReader } from '../cluster/ranged.ts';
import { corruptObject, fetchVerified } from '../cluster/pages.ts';
import { verifyPageBytes } from '../page/decode/host.ts';
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts';
import { families } from '../host/families.ts';
import { worldRootsPageSource } from './worldRootsPage.ts';
import { worldRootDag } from './worldSuperRoots.ts';
import { cellSuperRoots } from './partition/superRoots.ts';

/** The world pages' detached source, their DAG (#1238) and each cell's super-root bound, which a
 *  partition's plan reads (`partition/superRoots.ts`, #1332): nothing draws from them yet (#1333),
 *  so a scene opens without them, and their page server and DAG file are read on first use. */
type WorldStream = {
  source: ReturnType<typeof worldRootsPageSource>;
  dag: ReturnType<typeof worldRootDag>;
  superRoots: Float64Array | undefined;
};

type Announced = { bytes: number; sha256: string };
/** Where a cache keeps its world roots' table and the binary the cook writes beside it. */
const worldRootsUrls = (base: string) => ({
  table: new URL(WORLD_ROOTS_FILE, base).href,
  dag: new URL(WORLD_ROOTS_DAG, base).href,
  bin: new URL(WORLD_ROOTS_BIN, base).href,
});
/** What a load reads of the world roots `declared` lists, address to length: the table whole, and
 *  of the binary the one range it reads, the pinned top its cook published in `manifest`
 *  (`worldRoots.pinnedTopBytes`); a server that ignores the Range adds the rest as it arrives. */
export function worldRootsPlan(
  declared: ReadonlyMap<string, number>,
  base: string,
  manifest: object,
) {
  const { table, bin } = worldRootsUrls(base);
  const top = (manifest as { worldRoots?: { pinnedTopBytes?: number } }).worldRoots?.pinnedTopBytes;
  const plan: [string, number][] = [];
  if (declared.has(table)) plan.push([table, declared.get(table)!]);
  if (declared.has(bin) && top) plan.push([bin, top]);
  return plan;
}

/** Bundles `[first, end)` of the binary `read` reads (`rangedReader`), in one ranged request that
 *  `meter` counts, each checked against its digest, then its pages. */
async function readBundles(
  read: ReturnType<typeof rangedReader>,
  url: string,
  table: WorldRoots,
  [first, end]: number[],
  meter?: ByteMeter,
) {
  const from = table.bundles[first].offset,
    last = table.bundles[end - 1];
  const bytes = new Uint8Array(await read(from, last.offset + last.bytes - from, meter));
  return Promise.all(
    table.bundles.slice(first, end).map(async (bundle, i) => {
      const start = bundle.offset - from;
      const verified = await verifyPageBytes(bytes.slice(start, start + bundle.bytes).buffer);
      if (verified.sha256 !== bundle.sha256)
        throw corruptObject(`${url}#${first + i}`, bundle, bundle.bytes, verified.sha256);
      return worldBundlePages(new Uint8Array(verified.source), bundle.count, first + i);
    }),
  );
}

/**
 * The world roots of the cache `metadata` describes at `base`, their top read and pinned, or
 * `undefined` for a cache that publishes none (a scene with no placed DAG, or cooked before #23).
 */
export async function openWorldRoots(
  metadata: ClusterManifest,
  base: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
) {
  const files = (metadata as { files?: Record<string, Announced | undefined> }).files ?? {};
  const announced = files[WORLD_ROOTS_FILE];
  if (!announced) return undefined;
  const urls = worldRootsUrls(base);
  const bytes = await fetchVerified(urls.table, announced, signal, meter);
  const table = readWorldRoots(new Uint8Array(bytes));
  const url = new URL(table.payload.url, base).href;
  // The load's meter counts the top, read while it loads; a cell's bundles are read after it.
  const read = rangedReader(url, signal);
  const topBundles = await readBundles(read, url, table, [0, table.pinned], meter);
  /** The bundles past the top the placed cells hold: how many cells hold each, and its read. */
  const held = new Map<number, { cells: number; pages: Promise<WorldRootsPage[]> }>();
  let heldBytes = 0;
  const release = (cell: number) => {
    for (const bundle of cellDependencies(table, cell)) {
      const own = held.get(bundle);
      if (!own || --own.cells > 0) continue;
      held.delete(bundle);
      heldBytes -= table.bundles[bundle].bytes;
    }
  };
  /** A bundle's pages: the pinned top's and a placed cell's from what is held, any other read and
   *  verified for the one request (the GPU page pool keeps what it uploads, as Nanite's does). */
  const bundlePages = (bundle: number) =>
    bundle < table.pinned
      ? Promise.resolve(topBundles[bundle])
      : (held.get(bundle)?.pages ??
        readBundles(read, url, table, [bundle, bundle + 1]).then(([pages]) => pages));
  let stream: WorldStream | undefined;
  // Only an opened stream is kept: a family refusal is asked again on the next use (`onDemand`),
  // and a table out of rank is refused again, before any page is served.
  const openStream = async () => {
    if (stream) return stream;
    const { worldPageServer, worldRootPages } = await families.worldStream.load();
    // The world DAG's file, read once the stream opens: a load never holds it (#1232).
    const dag = files[WORLD_ROOTS_DAG];
    const records =
      dag && readWorldRootsDag(new Uint8Array(await fetchVerified(urls.dag, dag, signal)));
    return (stream ??= {
      dag: worldRootDag({ ...records, payload: table.payload }, worldRootPages),
      // An object root's cell is its object's (`origin`, the table's rank, #1332).
      superRoots:
        records &&
        cellSuperRoots(records.clusters, (origin) => table.cells.cellOf(origin), table.cells.count),
      source: worldRootsPageSource(worldPageServer(table, bundlePages)),
    });
  };
  return {
    table,
    /** The world pages' detached source, both engines' shape (`worldRootsPage.ts`), and their DAG
     *  in the engine's own `DagRoot` shape from the cook's rank order (`undefined` for a cache
     *  without its DAG file), opened once, on first use. A table out of its
     *  rank is refused here (`WORLD_CLUSTER_RANK`), before any page is drawn from it. */
    stream: openStream,
    /** The pinned top: its bundles, pages and bytes, for the scene's life. */
    pinned: { bundles: table.pinned, pages: topBundles.flat(), bytes: table.pinnedTopBytes },
    /** `cell` is placed: the bundles its objects' roots need past the top are read and held,
     *  each once whatever the cells sharing it. A read that fails holds nothing of the cell. */
    async hold(cell: number) {
      const reads = cellDependencies(table, cell).map((bundle) => {
        let own = held.get(bundle);
        if (!own) {
          const pages = readBundles(read, url, table, [bundle, bundle + 1]).then(([p]) => p);
          held.set(bundle, (own = { cells: 0, pages }));
          heldBytes += table.bundles[bundle].bytes;
        }
        own.cells++;
        return own.pages;
      });
      await Promise.all(reads).catch((error: unknown) => {
        release(cell);
        throw error;
      });
    },
    /** `cell` left: a bundle no placed cell needs any more is let go. */
    release,
    /** The bundles past the top the placed cells hold now, ascending. */
    held: () => [...held.keys()].sort((a, b) => a - b),
    /** Every byte held here: the pinned top's, the placed cells' bundles', and the whole binary a
     *  server that ignores the Range answered (`rangedReader`). */
    bytes: () =>
      table.pinnedTopBytes +
      heldBytes +
      read.held() +
      // The source's own bundles past the top and the held ones: kept for a page's other view.
      (stream?.source.keptBytes(held) ?? 0),
  };
}

export type WorldRootsHold = NonNullable<Awaited<ReturnType<typeof openWorldRoots>>>;
