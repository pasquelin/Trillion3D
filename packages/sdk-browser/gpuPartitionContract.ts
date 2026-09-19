/**
 * Memory layout the GPU partition shares with the Hi-Z test and with the host.
 *
 * Everything a frame used to decide row by row on the CPU — projecting boxes into screen
 * rectangles, occluder/tested split, packing the occlusion-test bounds — is written by compute
 * kernels into these three buffers. The CPU rereads only `state`, and only on the periodic-
 * sample cadence.
 */

/**
 * Floats of a world box: eight corners, each in three coordinates carried by TWO single-
 * precision values — the rounded value and its residue.
 *
 * A corner alone in single precision carries an error of `u|x|`, and on a model whose
 * coordinates are tens of thousands that error dominates all others: the conservative bound
 * then yielded rectangles of several hundred texels. Two floats represent the original double
 * to within `u²`, and the gap to the anchor is computed without ever bringing world magnitude
 * into view: the bound becomes proportional to the cluster size again.
 */
export const CORNER_VALUES = 48;

/**
 * Words per `rowData` row: the unclipped screen rectangle (four signed integers), the already-
 * corrected depth bound, the flags, the sortable depth key, and a guard word.
 */
export const ROW_DATA_U32 = 8;
export const ROW_NEAREST = 4,
  ROW_FLAGS = 5,
  ROW_KEY = 6;
/** Bits of `rowData[ROW_FLAGS]`. */
export const FLAG_CLIP = 1,
  FLAG_PREV_REST = 2,
  FLAG_HISTORY = 4;

/**
 * Words per tested box: the rectangle already clipped to the viewport and expressed in texels of
 * the mip that covers it, the depth bound, the verdict row, the mip address, and the triangles
 * whose count weighs a reject.
 */
export const TESTED_U32 = 12;

/** Threads of a per-row kernel workgroup. */
export const PARTITION_WORKGROUP = 64;

/**
 * Depth histogram of `state`: its first word, and the number of leading bits of the sortable key
 * that name a bucket.
 *
 * The key is that of VIEW depth, never of normalised depth. A float's leading bits are its
 * exponent, and a depth normalised by a perspective projection lives almost entirely in a
 * single exponent: every bucket but one stayed empty, the median threshold fell beyond every
 * box, and the whole frame went to the occluder side — the tested half held only clipped boxes,
 * which nothing rejects. View depth, for its part, spreads over about twenty exponents, and
 * twelve bits slice it finely enough for the threshold to fall near the median.
 */
export const STATE_HISTO = 16;
export const HISTO_BITS = 12;
export const HISTO_BUCKETS = 1 << HISTO_BITS;
/** Buckets a workgroup thread totals in the two-level sweep of `chooseSplit`. */
export const HISTO_BLOCK = HISTO_BUCKETS / PARTITION_WORKGROUP;
export const STATE_WORDS = STATE_HISTO + HISTO_BUCKETS;

/** Counters of `state`, all atomic: the three decisions `chooseSplit` sets are simply stored
 *  there by `atomicStore`, never accumulated. */
export const ST_TESTED = 0,
  ST_OCCLUDERS = 1,
  ST_HISTORY_OCCLUDERS = 2,
  ST_IN_FRONT = 3,
  ST_OVERSIZED = 4,
  ST_TESTED_TRIANGLES = 5,
  ST_OVERSIZED_TRIANGLES = 6,
  ST_REJECTED = 7,
  ST_REJECTED_TRIANGLES = 8,
  ST_THRESHOLD = 9,
  ST_MODE = 10,
  ST_TWO_PASS = 11;

/** Verdict of a row, one word per Hi-Z slot: the occluder half, the tested half the pyramid
 *  rejects, the tested half it keeps. The partition sets occluder and kept, the test brings some
 *  kept back to rejected; everything that draws — vertex stage, tested-half truncation, compute
 *  raster — reads this word, and a reader that would read two values loses clusters. */
export const VERDICT_OCCLUDER = 0,
  VERDICT_REJECTED = 1,
  VERDICT_KEPT = 2;

/** Reject predicate, the same text in every module that binds `hizFlags`: a valid slot at the
 *  rejected verdict. Its negation is what draws. */
export const HIZ_REJECTED_WGSL = `fn hizRejected(hizSlot:u32)->bool{return hizSlot!=0xffffffffu&&hizFlags[hizSlot]==${VERDICT_REJECTED}u;}`;

/** Split mode: the frame's median threshold, or the previous frame's occluder history. */
export const MODE_MEDIAN = 0,
  MODE_HISTORY = 1;

/**
 * Uniform words: view (16) and view-projection (16), both ALREADY composed with the anchor
 * translation; the anchor in two single-precision values, with the near plane; then the
 * scalars, then the mip table — offset and width — that bound packing reads.
 */
export const UNI_VIEW = 0,
  UNI_VIEW_PROJ = 16,
  UNI_ANCHOR = 32,
  UNI_ANCHOR_LOW = 36,
  UNI_SCALARS = 40,
  UNI_LEVELS = 48;
export const MAX_HIZ_LEVELS = 16;
export const UNIFORM_U32 = UNI_LEVELS + MAX_HIZ_LEVELS * 2;

/**
 * A double coordinate written as TWO single-precision values: round-to-nearest, then what it
 * left. The sum of the two represents the original double to within an ulp squared, and that is
 * the only form in which corners and the anchor enter the kernel (`gpuPartitionMargins.ts`). The
 * two positions are given separately because the layouts differ: a corner stores its residue
 * three floats further, the uniform four.
 */
export function writeSplitDouble(out: Float32Array, highAt: number, lowAt: number, value: number) {
  const high = Math.fround(value);
  out[highAt] = high;
  out[lowAt] = value - high;
}
