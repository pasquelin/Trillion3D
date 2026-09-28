import type { PageRec } from '../../../page/selection/selection.ts';
import { createWebgpuRowState } from '../../row/state.ts';
import { pageAddress } from '../../row/pageSlots.ts';
import { CORNER_VALUES } from '../../../gpu/partition/contract.ts';
import { DRAW_ITEM_U32 } from '../../../gpu/draw/draw.ts';
import { createCornerUploadHold } from '../../visibility/corners.ts';
import { createDrawItemWordsHold } from '../../visibility/itemWords.ts';
import { VIS_MAX_PAGES } from '../../../visibility/buffer.ts';
import { boundTableRows } from '../../row/tableRows.ts';
import type { WebgpuPagesSetup } from './setup.ts';
import type { BoxTransformLot } from '../../../math/batchRuntime.ts';

export type WebgpuPagesLayout = ReturnType<typeof createWebgpuPagesLayout>;

/** How many packed pages share each pool address, and the most at one: the rows a slot feeds. */
export type PoolCopies = { byAddress: Map<string, number>; max: number };

/** Counts `pages` into `copies`, one more placement each. */
export function countCopies(copies: PoolCopies, pages: readonly PageRec[]) {
  for (const page of pages) {
    const address = pageAddress(page),
      n = (copies.byAddress.get(address) ?? 0) + 1;
    copies.byAddress.set(address, n);
    copies.max = Math.max(copies.max, n);
  }
  return copies;
}

/**
 * The page table a scene of `opaque` and `blended` packed pages asks, on a pool of `slots` whose
 * address feeds `maxCopies` rows at most, bounded by one binding of the device (`limits`).
 * Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the triangle: rows
 * are the visibility buffer's, and only opaque clusters ever claim one. Blended clusters cast from
 * rows behind them, which only the shadow pass reads: as many as the pool can hold resident at
 * once, and none in a scene that blends nothing.
 */
export function askedTableRows(
  opaque: number,
  blended: number,
  slots: number,
  maxCopies: number,
  limits?: GPUSupportedLimits,
) {
  const draw = Math.max(1, Math.min(VIS_MAX_PAGES, opaque || 1, slots * maxCopies));
  return boundTableRows(limits, draw, Math.min(blended, slots * maxCopies));
}

/** The geometry of the drawing path: the packed opaque pages, the row table sized to the slot
 *  budget and to one binding of the device (`limits`), and every per-row scratch array the image
 *  reuses instead of reallocating. The table is fixed; placements grown in place join the roots
 *  and pages after the others (`../../../placement/webgpuGrowth.ts`). */
export function createWebgpuPagesLayout(setup: WebgpuPagesSetup, limits?: GPUSupportedLimits) {
  const { roots, bootstrap, cap: slots, pageBytes } = setup;
  const opaqueRoots = roots.filter((root) => !root.pages[0]?.transparent),
    transparentRoots = roots.filter((root) => root.pages[0]?.transparent);
  // One cluster catalogue for one cut: the opaque primitives first, then the transparent ones. The
  // GPU selection, the residency and the page budget read all of it; only the drawing path splits,
  // because a transparent cluster is blended in source order instead of entering the visibility
  // buffer. Keeping the opaque prefix first leaves every opaque page index exactly where it was.
  const selectionRoots = [...opaqueRoots, ...transparentRoots];
  const packedPages: PageRec[] = selectionRoots.flatMap((root) => root.pages);
  // A page's placement is its root's rank: what the row carries to find the placement motion
  // (`../../../taa/motion.ts`), posted once as `packedIndex`.
  selectionRoots.forEach((root, placement) => {
    for (const page of root.pages) page.placementIndex = placement;
  });
  const opaquePageCount = opaqueRoots.reduce((total, root) => total + root.pages.length, 0);
  const worldUpdates = new Float32Array(Math.max(1, selectionRoots.length) * 16);
  const gpuWanted: PageRec[] = bootstrap;
  const copies = countCopies({ byAddress: new Map(), max: 1 }, packedPages);
  const { drawSlots, blendSlots, bounded } = askedTableRows(
    opaquePageCount,
    packedPages.length - opaquePageCount,
    slots,
    copies.max,
    limits,
  );
  const rows = createWebgpuRowState(packedPages, drawSlots, blendSlots);
  /** Every triangle of every drawable row: the bound a raster list cannot exceed. */
  const rasterCapacity = drawSlots * Math.ceil(Math.max(1, pageBytes / 4) / 3);
  /** World-space corners per ROW, in single precision: what the GPU partition reads. They are
   *  derived from each page's local bounds and rewritten only on the table's dirty range. */
  const cornerPacked = new Float32Array(drawSlots * CORNER_VALUES);
  const cornerHold = createCornerUploadHold();
  /** Draw rows, held from one image to the next: only a changing row rewrites them. */
  const drawItemWords = new Uint32Array(drawSlots * DRAW_ITEM_U32);
  const itemWordsHold = createDrawItemWordsHold(drawSlots);
  return {
    /** Root-box batch, reserved at prepare and replayed on every node move; `null` until prepare has
     *  happened or when the batch cannot be fitted. */
    rootBoxes: null as BoxTransformLot | null,
    opaqueRoots,
    transparentRoots,
    selectionRoots,
    packedPages,
    opaquePageCount,
    /** The pool addresses' placements, which rows grown in place add to. */
    copies,
    worldUpdates,
    gpuWanted,
    drawSlots,
    rows,
    /** The rows the scene asked when one binding of the device held fewer, else null. */
    pageTableBound: bounded,
    rasterCapacity,
    cornerPacked,
    cornerHold,
    drawItemWords,
    itemWordsHold,
  };
}
