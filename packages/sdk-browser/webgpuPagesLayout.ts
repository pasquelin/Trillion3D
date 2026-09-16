import type { PageRec } from './pageSelection.ts';
import { createWebgpuRowState } from './webgpuRowState.ts';
import { HIZ_BOUNDS_VALUES, createBoxCorners } from './hiz.ts';
import { createProjectionHold } from './hizProjectionHold.ts';
import type { HizCountSample } from './gpuHiz.ts';
import { DRAW_ITEM_U32, MAX_DRAW_SLOTS } from './gpuDraw.ts';
import { createVisibilityItemsHold } from './webgpuVisibilityItems.ts';
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
  // The occluder half of an image is reused as the next image's first pass, and it is keyed by cluster
  // key: a key backing several placements occludes for all of them. A dense index per key replaces the
  // set of strings the drawing path used to hash once per page per image.
  const urlIndexOfPage = new Int32Array(packedPages.length);
  let urlCount = 0;
  {
    const dense = new Map<string, number>();
    for (let i = 0; i < packedPages.length; i++) {
      const url = packedPages[i].url;
      let index = dense.get(url);
      if (index === undefined) {
        index = urlCount++;
        dense.set(url, index);
      }
      urlIndexOfPage[i] = index;
    }
  }
  const drawnOccluderUrls = new Uint8Array(Math.max(1, urlCount));
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
   * image; it no longer retransforms them.
   */
  const boxCorners = createBoxCorners(packedPages.length);
  const hizBounds = new Float64Array(drawSlots * HIZ_BOUNDS_VALUES);
  /** Which of those rectangles still describe the image, and which the next one must reproject. */
  const hizProjection = createProjectionHold(drawSlots);
  const hizTestedBounds = new Float64Array(drawSlots * HIZ_BOUNDS_VALUES);
  const hizTestedRows = new Uint32Array(drawSlots);
  /** Triangles of each tested cluster, in the order the boxes are handed to the test: what the
   *  elimination counters weigh a rejected cluster by. Sized once, like the rows beside it. */
  const hizTestedTriangles = new Uint32Array(drawSlots);
  /** What the GPU test reads the triangles of a verdict from, and the image those verdicts belong to. */
  const hizCountSample: HizCountSample = { triangles: hizTestedTriangles, frame: 0 };
  const hizRest = new Uint8Array(drawSlots);
  const drawItemWords = new Uint32Array(drawSlots * DRAW_ITEM_U32);
  const drawRestBits = new Uint32Array(Math.max(1, Math.ceil(drawSlots / 32)));
  /** Lignes par slot indirect (pipeline, moitié, puis couche coplanaire) : un slot que rien ne
   *  remplit ne vaut pas un appel de dessin. Dimensionné pour toutes les couches nommables. */
  const binInstances = new Uint32Array(MAX_DRAW_SLOTS);
  /** Ce que la dernière construction de fiches a produit, et ce dont elle dépendait. */
  const itemsHold = createVisibilityItemsHold();
  return {
    opaqueRoots,
    transparentRoots,
    selectionRoots,
    packedPages,
    opaquePageCount,
    worldUpdates,
    urlIndexOfPage,
    drawnOccluderUrls,
    gpuWanted,
    drawSlots,
    rows,
    smallTriangleCapacity,
    boxCorners,
    hizBounds,
    hizProjection,
    hizTestedBounds,
    hizTestedRows,
    hizTestedTriangles,
    hizCountSample,
    hizRest,
    drawItemWords,
    drawRestBits,
    binInstances,
    itemsHold,
  };
}
