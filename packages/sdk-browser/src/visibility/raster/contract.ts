import { DAG_CLUSTER_VERTICES } from '../../../../sdk-core/src/page/format.ts'

/**
 * Software-raster contract: one writing of the numbers that both the WGSL and the encoder read.
 *
 * THE SPLIT IS PER CLUSTER, as the cut hands clusters to the rasters: a cluster whose longest
 * edge, projected at the nearest point of its level-of-detail sphere, stays under
 * `hardwareRasterEdgePixels` (32 by default)
 * and whose box crosses neither the near nor the far plane is rastered here, in compute; every
 * other one by the hardware raster, which clips (`../../geometry/dag/shader/visibleWgsl.ts`: the
 * cut decides it where it appends the cluster to its list). Lines, sprites and voxel bricks, which
 * the vertex stage widens, turns or traces, are always hardware's. Blend keeps its pass.
 *
 * THE UNIT OF WORK IS THE CLUSTER: the bins list the clusters the cut hands to compute, and one group
 * of sixty-four threads rasters one listed cluster (`clusterWgsl.ts`) — its vertices transformed once
 * into the group's memory, a thread to a triangle.
 */

/** Subpixel samples on a pixel's side: eight fractional bits, the precision a vertex is snapped
 *  to before its edges are set up — the hardware rasterizers' own. */
export const SUBPIXEL_SAMPLES = 256
/** The widest pixel box a triangle setup keeps, past its first pixel: 64 pixels a side, the
 *  bound the cluster split already holds a software triangle under (its edges stay below the
 *  32-pixel threshold). */
export const MAX_SPAN = 63
/** Vertices a group holds in its memory at once: the most an encoded cluster has. A row with more
 *  — an older cache's, or one that is not a quantized page — transforms the corners of each
 *  triangle as it sets it up. */
export const VERTEX_CACHE = DAG_CLUSTER_VERTICES
/** A triangle whose box is wider than this many pixels is rastered by scanlines, the others by
 *  their box: the edge a group of lanes tells the two apart at. */
export const SCANLINE_SPAN = 4

/**
 * The cut's two passes, each with a list of its own: `MAIN` the clusters the main pass drew
 * against the previous image's pyramid — the records of the list of visible clusters before the post
 * pass opened —, `POST` those the post pass drew against the pyramid of the main pass's depth — the
 * records it appended (`VIS_SW_SPLIT`, `VIS_HW_SPLIT`, `../../geometry/dag/visible/layout.ts`). A
 * cluster is in one of them only.
 */
export const RASTER_PASS_MAIN = 0,
  RASTER_PASS_POST = 1
/** The passes, in the order the image draws them. */
export const RASTER_PASSES = [RASTER_PASS_MAIN, RASTER_PASS_POST] as const
export type RasterPass = (typeof RASTER_PASSES)[number]

/**
 * The two modes of the software raster: `DEPTH` writes the pass's depth — on a device with the
 * 64-bit atomic maximum the pair (depth, identifier) whole, and it is the only mode —, `ID`, on a
 * device without it, resolves identifiers on the final depth, once both passes wrote theirs
 * (`visWriteWgsl`).
 */
export const MODE_DEPTH = 0,
  MODE_ID = 1

/** Entry-point name of the software raster in a mode: one rule, both sides read it. */
export const rasterEntry = (mode: number) => (mode === MODE_ID ? 'clusterIds' : 'clusterDepth')

/**
 * A pass's lists of clusters in the lists buffer, written by the bins (`../bins/binsWgsl.ts`). The
 * buffer opens with the two passes' headers, one after the other (`headerWord`), then holds the
 * entries — the index of a cluster in the list of visible clusters each —: first the software
 * raster's, `capacity` at most, then the tessellation's, `capacity` more (`listWords`). A pass's
 * entries follow its predecessor's: the main pass's lie from the start of each, the post pass's
 * behind them. A header is, as words from its first (the pass's `LIST`):
 *  - `LIST_COUNT`, the software clusters listed, the clusters of no cutout first, the cutout ones
 *    after them, nearest depth bucket first (`DEPTH_BUCKETS`), and `LIST_AT`, the word of the buffer
 *    its first lies at;
 *  - the three words of the indirect dispatch of the software raster over them (`LIST_DISPATCH`),
 *    contiguous so that they copy as one;
 *  - `LIST_TESS_COUNT`, `LIST_TESS_AT` and `LIST_TESS_DISPATCH`: the same for the clusters whose
 *    displaced surface the frame tessellates, which the seeding of the patches reads.
 */
export const LIST_COUNT = 0,
  LIST_AT = 1,
  LIST_DISPATCH = 2,
  LIST_TESS_COUNT = 5,
  LIST_TESS_AT = 6,
  LIST_TESS_DISPATCH = 7
const LIST_HEADER = 10
/** Depth buckets of the order: the reference's own number, 256. */
export const DEPTH_BUCKETS = 256
/** The first word of pass `pass`'s header. */
export const headerWord = (pass: RasterPass) => pass * LIST_HEADER
/** The first entry's word of the buffer: behind both headers. */
export const LIST_ROWS = RASTER_PASSES.length * LIST_HEADER
/** Words of the lists buffer for lists of `capacity` clusters: both headers, then the software
 *  raster's entries and the tessellation's. */
export const rasterListWords = (capacity: number) => LIST_ROWS + 2 * capacity
