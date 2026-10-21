/**
 * Software-raster contract: one writing of the numbers that both the WGSL and the encoder read.
 *
 * THE SPLIT IS PER CLUSTER, as the cut hands clusters to the rasters: a cluster whose longest
 * edge, projected at the nearest point of its level-of-detail sphere, stays under
 * `hardwareRasterEdgePixels` (32 by default)
 * and whose box crosses neither the near nor the far plane is rastered here, in compute; every
 * other one by the hardware raster, which clips (`binWgsl.ts`). Lines, sprites and voxel bricks,
 * which the vertex stage widens, turns or traces, are always hardware's. Blend keeps its pass.
 *
 * Three size classes, two lists a pass. A class says how many pixels a sixty-four-thread group covers
 * at once, never what a triangle is worth: the class is read on the triangle's pixel box,
 * clipped to the viewport and to the `MAX_SPAN` every triangle setup holds. Fine and coarse
 * share a list, filled from both ends: neither overflows while the other has room, and the
 * bound is held on the sum; large has the other one.
 */

/** Side of the fine-class tile, and triangles a sixty-four-thread group treats there. */
export const FINE_SIDE = 4

export const FINE_PER_GROUP = 64 / (FINE_SIDE * FINE_SIDE)
/** Side of a full group's tile: the coarse class fits in one, the large class loops. */
export const TILE = 8
/** The widest pixel box a triangle setup keeps, past its first pixel: 64 pixels a side, the
 *  bound the cluster split already holds a software triangle under (its edges stay below the
 *  32-pixel threshold). */
export const MAX_SPAN = 63
/** Maximum span of a fine-class box: a tile of `FINE_SIDE` pixels on a side. */
export const FINE_SPAN = FINE_SIDE - 1
/** Subpixel samples on a pixel's side: eight fractional bits, the precision a vertex is snapped
 *  to before its edges are set up — the hardware rasterizers' own. */
export const SUBPIXEL_SAMPLES = 256

/** Words the list reserves before its entries: the three class counts, then the three
 *  dispatches the `plan` kernel derives from them. */
export const CNT_FINE = 0,
  CNT_COARSE = 1,
  CNT_LARGE = 2
/** First word of the indirect dispatches; they are contiguous so they copy as one. */
export const DISPATCH_BASE = 3
export const DISPATCH_WORDS = 9
export const LIST_HEADER = DISPATCH_BASE + DISPATCH_WORDS
/** Words of one pass's lists: its header, then the fine-and-coarse list and the large one,
 *  `capacity` entries each. */
export const rasterListWords = (capacity: number) => LIST_HEADER + 2 * capacity

/**
 * The cut's two passes, each with lists of its own in the work buffer: `MAIN` the clusters the
 * main pass drew against the previous image's pyramid — selected by the frame mask before the
 * post pass —, `POST` those the post pass drew against the pyramid of the main pass's depth —
 * selected by the post mask (`GpuSelection.postMaskOffset`). A cluster is in one of them only.
 */
export const RASTER_PASS_MAIN = 0,
  RASTER_PASS_POST = 1
/** The passes, in the order the image draws them. */
export const RASTER_PASSES = [RASTER_PASS_MAIN, RASTER_PASS_POST] as const
export type RasterPass = (typeof RASTER_PASSES)[number]

/**
 * The two modes of a raster kernel: `DEPTH` writes its pass's depth keys — the main pass's are what
 * the pyramid reduces —, `ID` resolves identifiers on the final depth, once both passes wrote
 * theirs (`VIS_WRITE_WGSL`).
 */
export const MODE_DEPTH = 0,
  MODE_ID = 1

/** The three classes, in the order of their indirect dispatches. */
export const RASTER_CLASSES = ['fine', 'coarse', 'large'] as const
type RasterClass = (typeof RASTER_CLASSES)[number]

/** Entry-point name of a class in a mode: one rule, both sides read it. */
export const rasterEntry = (klass: RasterClass, mode: number) => `${klass}${mode}`
