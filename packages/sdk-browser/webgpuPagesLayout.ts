import type { PageRec } from './pageSelection.ts';
import { createWebgpuRowState } from './webgpuRowState.ts';
import { createBoxCorners } from './hiz.ts';
import { CORNER_VALUES } from './gpuPartitionContract.ts';
import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import { createCornerUploadHold } from './webgpuVisibilityCorners.ts';
import { createDrawItemWordsHold } from './webgpuVisibilityItemWords.ts';
import { VIS_MAX_PAGES } from './visibilityBuffer.ts';
import type { WebgpuPagesSetup } from './webgpuPagesSetup.ts';

export type WebgpuPagesLayout = ReturnType<typeof createWebgpuPagesLayout>;

/** The fixed geometry of the drawing path: the packed opaque pages, the row table sized to the slot
 *  budget, and every per-row scratch array the image reuses instead of reallocating. */
export function createWebgpuPagesLayout(setup: WebgpuPagesSetup) {
  const { roots, bootstrap, slots, pageBytes } = setup;
  const opaqueRoots = roots.filter((root) => !root.pages[0]?.transparent),
    transparentRoots = roots.filter((root) => root.pages[0]?.transparent);
  // One cluster catalogue for one cut: the opaque primitives first, then the transparent ones. The
  // GPU selection, the residency and the page budget read all of it; only the drawing path splits,
  // because a transparent cluster is blended in source order instead of entering the visibility
  // buffer. Keeping the opaque prefix first leaves every opaque page index exactly where it was.
  const selectionRoots = [...opaqueRoots, ...transparentRoots];
  const packedPages: PageRec[] = selectionRoots.flatMap((root) => root.pages);
  const opaquePageCount = opaqueRoots.reduce((total, root) => total + root.pages.length, 0);
  const worldUpdates = new Float32Array(Math.max(1, selectionRoots.length) * 16);
  const gpuWanted: PageRec[] = bootstrap;
  const copiesByUrl = new Map<string, number>();
  let maxCopies = 1;
  for (const page of packedPages) {
    const n = (copiesByUrl.get(page.url) ?? 0) + 1;
    copiesByUrl.set(page.url, n);
    maxCopies = Math.max(maxCopies, n);
  }
  // Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the triangle.
  // Rows are the visibility buffer's, and only opaque clusters ever claim one.
  const drawSlots = Math.max(1, Math.min(VIS_MAX_PAGES, opaquePageCount || 1, slots * maxCopies));
  const rows = createWebgpuRowState(packedPages, drawSlots);
  /** Every triangle of every drawable row: the bound the small-triangle list can never exceed. */
  const smallTriangleCapacity = drawSlots * Math.ceil(Math.max(1, pageBytes / 4) / 3);
  /**
   * World-space corners of every page's box, kept across images and rebuilt only when the epoch of the
   * shared inputs changes — the same epoch a row is rewritten on. A moving camera reprojects them every
   * image; it no longer retransforms them, and the projection itself no longer runs on this side.
   */
  const boxCorners = createBoxCorners(packedPages.length);
  /** Les mêmes coins, par LIGNE et en simple précision : ce que la partition GPU lit. Ils ne sont
   *  réécrits que sur la plage sale de la table, jamais par image. */
  const cornerPacked = new Float32Array(drawSlots * CORNER_VALUES);
  const cornerHold = createCornerUploadHold();
  /** Les fiches de dessin, tenues d'une image à l'autre : seule une ligne qui change les réécrit. */
  const drawItemWords = new Uint32Array(drawSlots * DRAW_ITEM_U32);
  const itemWordsHold = createDrawItemWordsHold(drawSlots);
  return {
    opaqueRoots,
    transparentRoots,
    selectionRoots,
    packedPages,
    opaquePageCount,
    worldUpdates,
    gpuWanted,
    drawSlots,
    rows,
    smallTriangleCapacity,
    boxCorners,
    cornerPacked,
    cornerHold,
    drawItemWords,
    itemWordsHold,
  };
}
