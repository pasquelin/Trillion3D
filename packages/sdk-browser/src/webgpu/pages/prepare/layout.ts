import type { PageRec } from '../../../page/selection/selection.ts';
import { createWebgpuRowState } from '../../row/state.ts';
import { pageAddress } from '../../row/pageSlots.ts';
import { CORNER_VALUES } from '../../../gpu/partition/contract.ts';
import { DRAW_ITEM_U32 } from '../../../gpu/draw/draw.ts';
import { createCornerUploadHold } from '../../visibility/corners.ts';
import { createDrawItemWordsHold } from '../../visibility/itemWords.ts';
import { VIS_MAX_PAGES } from '../../../visibility/buffer.ts';
import { boundTableRows, CUT_ROWS, VIEW_ROWS } from '../../row/tableRows.ts';
import type { WebgpuPagesSetup } from './setup.ts';
import type { BoxTransformLot } from '../../../math/batchRuntime.ts';
import { postPackedBases } from '../../../page/selection/placements.ts';
import { createPackedPages, createPageCatalogue } from './catalogue.ts';
import { createPackedInstances } from '../../row/instances.ts';

export type WebgpuPagesLayout = ReturnType<typeof createWebgpuPagesLayout>;

/** How many packed pages share each pool address, and the most at one: the rows a slot feeds. */
export type PoolCopies = { byAddress: Map<string, number>; max: number };

/** Counts `pages` into `copies`, `by` more placements each. */
function countCopies(copies: PoolCopies, pages: readonly PageRec[], by: number) {
  for (const page of pages) {
    const address = pageAddress(page),
      n = (copies.byAddress.get(address) ?? 0) + by;
    copies.byAddress.set(address, n);
    copies.max = Math.max(copies.max, n);
  }
  return copies;
}

/** The placements of each primitive among `roots`, a primitive being its shared `pages` array. */
function placementsByPrimitive(roots: readonly { readonly pages: readonly PageRec[] }[]) {
  const counts = new Map<readonly PageRec[], number>();
  for (const { pages } of roots) counts.set(pages, (counts.get(pages) ?? 0) + 1);
  return counts;
}

/** Counts the pages of `roots` into `copies`: each primitive page once, by its placement count —
 *  O(primitive pages), never one step per packed instance (#1235). */
export function countRootCopies(
  copies: PoolCopies,
  roots: readonly { readonly pages: readonly PageRec[] }[],
) {
  for (const [pages, placements] of placementsByPrimitive(roots))
    countCopies(copies, pages, placements);
  return copies;
}

/**
 * The page table a scene of `opaque` and `blended` packed pages asks, on a pool of `slots` whose
 * address feeds `maxCopies` rows at most, bounded by one binding of the device (`limits`).
 * Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the triangle: rows
 * are the visibility buffer's, and only opaque clusters ever claim one. Blended clusters cast from
 * rows behind them, which only the shadow pass reads: as many as the pool can hold resident at
 * once, and none in a scene that blends nothing. Neither side passes the rows the view holds,
 * `viewRows` (`VIEW_ROWS`, `CUT_ROWS` on the CPU cut, until a cut selected more): a thousand
 * placements of a page ask no more
 * than the view draws (#1232).
 */
export function askedTableRows(
  opaque: number,
  blended: number,
  slots: number,
  maxCopies: number,
  limits?: GPUSupportedLimits,
  viewRows = VIEW_ROWS,
) {
  const resident = slots * maxCopies;
  const draw = Math.max(1, Math.min(VIS_MAX_PAGES, opaque || 1, resident, viewRows));
  return boundTableRows(limits, draw, Math.min(blended, resident, viewRows));
}

/** The geometry of the drawing path: the packed opaque pages, the row table sized to the slot
 *  budget and to one binding of the device (`limits`), and every per-row scratch array the image
 *  reuses instead of reallocating. Placements grown in place join the roots and pages after the
 *  others (`../../../placement/webgpuGrowth.ts`); the table itself grows in place when a larger
 *  pool or those placements ask more rows (`growTables.ts`). */
export function createWebgpuPagesLayout(setup: WebgpuPagesSetup, limits?: GPUSupportedLimits) {
  const { roots, bootstrap, cap: slots, pageBytes } = setup;
  const opaqueRoots = roots.filter((root) => !root.pages[0]?.transparent),
    transparentRoots = roots.filter((root) => root.pages[0]?.transparent);
  // One cluster catalogue for one cut: the opaque primitives first, then the transparent ones. The
  // GPU selection, the residency and the page budget read all of it; only the drawing path splits,
  // because a transparent cluster is blended in source order instead of entering the visibility
  // buffer. Placements grown in place append their opaque pages after the transparent ones: a
  // page's kind is read from the page, never from its rank.
  const selectionRoots = [...opaqueRoots, ...transparentRoots];
  // One record serves every placement of its primitive (#1235): the packed order is the INSTANCES
  // — a (placement, page) pair —, and the per-placement tables say which root each packed rank
  // belongs to. Every reader finds a page's world, row and winding through `placement`, never on
  // the shared record.
  // No list holds one entry per instance: a rank resolves through `placement` to its root and the
  // root's shared `pages` (`createPackedPages`), as a Nanite instance reads its primitive's pages
  // from its own base.
  const placement = postPackedBases(selectionRoots);
  const packedPages = createPackedPages(selectionRoots, placement);
  const opaquePageCount = opaqueRoots.reduce((total, root) => total + root.pages.length, 0);
  const worldUpdates = new Float32Array(Math.max(1, selectionRoots.length) * 16);
  const gpuWanted: PageRec[] = bootstrap;
  const copies = countRootCopies({ byAddress: new Map(), max: 1 }, selectionRoots);
  // A scene the GPU cut cannot hold opens with the rows of a view, and its cut grows them.
  const viewRows = packedPages.length > VIEW_ROWS ? CUT_ROWS : VIEW_ROWS;
  const { drawSlots, blendSlots, bounded } = askedTableRows(
    opaquePageCount,
    packedPages.length - opaquePageCount,
    slots,
    copies.max,
    limits,
    viewRows,
  );
  // The one catalogue over `packedPages`: its `recordOf` is how a consumer resolves the packed
  // ranks the cut publishes, and the row state indexes it once (`./catalogue.ts`).
  const catalogue = createPageCatalogue(packedPages);
  const instances = createPackedInstances(selectionRoots, placement);
  const rows = createWebgpuRowState(packedPages, drawSlots, blendSlots, instances);
  return {
    /** Root-box batch, reserved at prepare and replayed on every node move; `null` until prepare has
     *  happened or when the batch cannot be fitted. */
    rootBoxes: null as BoxTransformLot | null,
    transparentRoots,
    selectionRoots,
    packedPages,
    /** The packed rank of a page to its record: the engine's one catalogue accessor. */
    recordOf: catalogue.recordOf,
    /** The root rank of each packed rank, and the packed base of each root (#1235): one object for
     *  the session, read-only here, which a growth rewrites in place (`postPackedBases(roots, into)`)
     *  so the readers built once — the closure, the page parents, the held residency — follow it. */
    get placement() {
      return placement;
    },
    opaquePageCount,
    /** The pool addresses' placements, which rows grown in place add to. */
    copies,
    /** The rows the view holds (`../../row/tableRows.ts`): the table is never asked past them, and
     *  only a cut that selected more raises them (`growTables.ts`, `followCutRows`). */
    viewRows,
    worldUpdates,
    gpuWanted,
    /** The visibility rows, as the table stands: it grows in place (`growTables.ts`), so every
     *  reader of the table's size reads it here, at each use. */
    get drawSlots() {
      return rows.blendFirst;
    },
    rows,
    /** The rows the scene asked when one binding of the device held fewer, else null. */
    pageTableBound: bounded,
    /** The growth of the tables under way, which the next one waits for (`growTables.ts`). */
    growing: undefined as Promise<unknown> | undefined,
    ...rowScratch(drawSlots, pageBytes),
  };
}

/** The per-row scratch arrays of a table of `drawSlots` visibility rows, and the witnesses of what
 *  the GPU holds of them: made anew when the table grows (`growTables.ts`), they then send every
 *  row again, once. */
export function rowScratch(drawSlots: number, pageBytes: number) {
  return {
    /** Every triangle of every drawable row: the bound a raster list cannot exceed. */
    rasterCapacity: drawSlots * Math.ceil(Math.max(1, pageBytes / 4) / 3),
    /** World-space corners per ROW, in single precision: what the GPU partition reads. They are
     *  derived from each page's local bounds and rewritten only on the table's dirty range. */
    cornerPacked: new Float32Array(drawSlots * CORNER_VALUES),
    cornerHold: createCornerUploadHold(),
    /** Draw rows, held from one image to the next: only a changing row rewrites them. */
    drawItemWords: new Uint32Array(drawSlots * DRAW_ITEM_U32),
    itemWordsHold: createDrawItemWordsHold(drawSlots),
  };
}
