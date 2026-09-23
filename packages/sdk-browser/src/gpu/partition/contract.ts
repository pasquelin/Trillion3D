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
 * corrected depth bound, and the flags. What a row held from the previous image is read before
 * this image overwrites it: that is the whole occluder history.
 */
export const ROW_DATA_U32 = 6;
export const ROW_NEAREST = 4,
  ROW_FLAGS = 5;
/** Bits of `rowData[ROW_FLAGS]`. */
export const FLAG_CLIP = 1,
  FLAG_PREV_REST = 2,
  FLAG_HISTORY = 4,
  /** The row's rectangle and depth were written by a projection: a row never projected — a new
   *  rank, a fresh buffer — carries nothing the previous image's pyramid could judge. */
  FLAG_PROJECTED = 8,
  /** Kept by the occlusion test while the view stood still: the row stays an occluder until the
   *  view moves, instead of leaving the occluders under one antialiasing jitter and coming back
   *  under the next. */
  FLAG_KEPT = 16;

/**
 * Words per tested box: the rectangle already clipped to the viewport and expressed in texels of
 * the mip that covers it, the depth bound, the verdict row, the mip address, and the triangles
 * whose count weighs a reject.
 */
export const TESTED_U32 = 12;

/** Threads of a per-row kernel workgroup. */
export const PARTITION_WORKGROUP = 64;

/** Words of `state`: the frame counters, all atomic. */
export const STATE_WORDS = 16;

/** Counters of `state`: what the frame decided and what the occlusion test then rejected. */
export const ST_TESTED = 0,
  ST_OCCLUDERS = 1,
  ST_HISTORY_OCCLUDERS = 2,
  /** Rows drawn last image that last image's pyramid withdrew from this image's occluders. */
  ST_WITHDRAWN = 3,
  ST_OVERSIZED = 4,
  ST_TESTED_TRIANGLES = 5,
  ST_OVERSIZED_TRIANGLES = 6,
  ST_REJECTED = 7,
  ST_REJECTED_TRIANGLES = 8;

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

/** Bindings of the partition module, by name: the number `PARTITION_SHADER` declares each under. */
export const PARTITION_BINDING = {
  corners: 0,
  items: 1,
  flags: 2,
  rowData: 3,
  tested: 4,
  restBits: 5,
  slotUsed: 6,
  state: 7,
  uniforms: 8,
  pyramid: 9,
} as const;
/** What each kernel binds: a stage may bind eight storage buffers, and the two together would
 *  need nine, so each layout names only the buffers its entry point reads or writes. */
export const PARTITION_KERNEL_BINDINGS = {
  projectRows: ['corners', 'items', 'flags', 'rowData', 'state', 'uniforms', 'pyramid'],
  classifyRows: [
    'items',
    'flags',
    'rowData',
    'tested',
    'restBits',
    'slotUsed',
    'state',
    'uniforms',
  ],
} as const satisfies Record<string, readonly (keyof typeof PARTITION_BINDING)[]>;

/**
 * Uniform words: view (16) and view-projection (16), both ALREADY composed with the anchor
 * translation; the anchor in two single-precision values, with the near plane; then the
 * scalars — nine, padded to the sixteen-byte alignment of the array that follows —, then the
 * mip table — offset and width — that bound packing reads.
 */
export const UNI_VIEW = 0,
  UNI_VIEW_PROJ = 16,
  UNI_ANCHOR = 32,
  UNI_ANCHOR_LOW = 36,
  UNI_SCALARS = 40,
  UNI_LEVELS = 52;
export const MAX_HIZ_LEVELS = 16;
export const UNIFORM_U32 = UNI_LEVELS + MAX_HIZ_LEVELS * 2;

/**
 * A double coordinate written as TWO single-precision values: round-to-nearest, then what it
 * left. The sum of the two represents the original double to within an ulp squared, and that is
 * the only form in which corners and the anchor enter the kernel (`margins.ts`). The
 * two positions are given separately because the layouts differ: a corner stores its residue
 * three floats further, the uniform four.
 */
export function writeSplitDouble(out: Float32Array, highAt: number, lowAt: number, value: number) {
  const high = Math.fround(value);
  out[highAt] = high;
  out[lowAt] = value - high;
}
