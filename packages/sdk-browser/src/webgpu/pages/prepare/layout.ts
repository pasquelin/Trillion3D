import type { PageRec } from '../../../page/selection/selection.ts';
import { createWebgpuRowState } from '../../row/state.ts';
import { pageAddress } from '../../row/pageSlots.ts';
import { createBoxCorners } from '../../../hiz/hiz.ts';
import { CORNER_VALUES } from '../../../gpu/partition/contract.ts';
import { DRAW_ITEM_U32 } from '../../../gpu/draw/draw.ts';
import { createCornerUploadHold } from '../../visibility/corners.ts';
import { createDrawItemWordsHold } from '../../visibility/itemWords.ts';
import { VIS_MAX_PAGES } from '../../../visibility/buffer.ts';
import type { WebgpuPagesSetup } from './setup.ts';
import type { BoxTransformLot } from '../../../math/batchRuntime.ts';

export type WebgpuPagesLayout = ReturnType<typeof createWebgpuPagesLayout>;

/** The fixed geometry of the drawing path: the packed opaque pages, the row table sized to the slot
 *  budget, and every per-row scratch array the image reuses instead of reallocating. */
export function createWebgpuPagesLayout(setup: WebgpuPagesSetup) {
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
  // Rows one pool slot can feed: how many placements share a pool address, at the widest.
  const copiesByAddress = new Map<string, number>();
  let maxCopies = 1;
  for (const page of packedPages) {
    const address = pageAddress(page),
      n = (copiesByAddress.get(address) ?? 0) + 1;
    copiesByAddress.set(address, n);
    maxCopies = Math.max(maxCopies, n);
  }
  // Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the triangle.
  // Rows are the visibility buffer's, and only opaque clusters ever claim one.
  const drawSlots = Math.max(1, Math.min(VIS_MAX_PAGES, opaquePageCount || 1, slots * maxCopies));
  const rows = createWebgpuRowState(packedPages, drawSlots);
  /** Every triangle of every drawable row: the bound a raster list cannot exceed. */
  const rasterCapacity = drawSlots * Math.ceil(Math.max(1, pageBytes / 4) / 3);
  /**
   * World-space corners of every page's box, kept across images and rebuilt only when the epoch of the
   * shared inputs changes — the same epoch a row is rewritten on. A moving camera reprojects them every
   * image; it no longer retransforms them, and the projection itself no longer runs on this side.
   */
  const boxCorners = createBoxCorners(packedPages.length);
  /** The same corners, per ROW and in single precision: what the GPU partition reads. They are
   *  rewritten only on the table's dirty range, never per image. */
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
    worldUpdates,
    gpuWanted,
    drawSlots,
    rows,
    rasterCapacity,
    boxCorners,
    cornerPacked,
    cornerHold,
    drawItemWords,
    itemWordsHold,
  };
}
