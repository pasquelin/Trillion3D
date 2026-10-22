/**
 * THE OCCLUSION SEARCH'S DATA: what a shader quality fixes (the samples' set, the steps along each, the
 * blur among the four pixels of a quad), the offsets of the two sample sets, and the sixteen directions
 * the pixels turn them by (`AO_RANDOM_BASIS`). Pure data, written once; the shaders (`occlusionWgsl.ts`)
 * read the same tables as the host does, so that none is typed twice.
 */

/** A quality's shape: the sample set (1: three points, 3: six), the steps along each sample's
 *  direction, and whether a pixel blends with its two neighbours in the quad it is drawn in. */
export interface AoQualityShape {
  readonly sampleSet: 1 | 3
  readonly steps: 1 | 2 | 3
  readonly quadBlur: boolean
}

/** The shapes of the five shader qualities, 0 (the fewest samples) to 4. */
export const AO_QUALITY_SHAPES: readonly AoQualityShape[] = [
  { sampleSet: 1, steps: 1, quadBlur: false },
  { sampleSet: 1, steps: 1, quadBlur: true },
  { sampleSet: 1, steps: 2, quadBlur: true },
  { sampleSet: 1, steps: 3, quadBlur: false },
  { sampleSet: 3, steps: 3, quadBlur: false },
]

/** The offsets of the samples on the unit disc, by set: the three points spread over a spiral, and
 *  the six near the surface and fading out. */
export const AO_SAMPLE_SETS: Readonly<Record<1 | 3, readonly (readonly [number, number])[]>> = {
  1: [
    [0, -0.43],
    [0.58 * 0.7, 0.814 * 0.7],
    [-0.58, 0.814],
  ],
  3: [
    [0.0, 0.2],
    [0.325, 0.101],
    [0.272, -0.396],
    [-0.385, -0.488],
    [-0.711, 0.274],
    [0.06, 0.9],
  ],
}

/**
 * The sixteen directions a 4 × 4 block of pixels turns its samples by, indexed `x + 4 y`, as the two bytes of each
 * texel of the noise texture hold them: the block's rotation basis spread over half a turn in a fixed order, each
 * scaled down by a share that varies with its rank, its cosine and its sine quantised to a byte (`bytes / 255 · 2 − 1`).
 * Written as the bytes; the derivation, in single precision, is checked against them where the tables are tested.
 */
export const AO_NOISE_BYTES = [
  [240, 128],
  [67, 219],
  [147, 224],
  [225, 193],
  [89, 221],
  [197, 197],
  [3, 152],
  [38, 217],
  [174, 240],
  [127, 242],
  [225, 147],
  [30, 168],
  [41, 186],
  [242, 175],
  [103, 250],
  [194, 227],
] as const

/** The directions the bytes hold, each a pair `(cos, sin)` of `[-1, 1]`. */
export const AO_RANDOM_BASIS: readonly (readonly [number, number])[] = AO_NOISE_BYTES.map(
  ([cos, sin]) => [(cos / 255) * 2 - 1, (sin / 255) * 2 - 1] as const,
)

/** The texels of the noise block along an axis. */
export const AO_BASIS_SIDE = 4
/** The noise texture's side in texels, a multiple of the block's: where the temporal offset wraps. */
export const AO_NOISE_SIDE = 64
/** What a pixel's noise moves by for each image of the temporal sequence, in texels, and the images
 *  of it before it comes round. */
export const AO_TEMPORAL_STEP = [2.48, 7.52] as const
export const AO_TEMPORAL_IMAGES = 8
