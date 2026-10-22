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
    [0 * 0.43, -1 * 0.43],
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

/** The order the sixteen directions of a 4 × 4 block of pixels are spread in. */
const REORDER = [0, 11, 7, 3, 10, 4, 15, 12, 6, 8, 1, 14, 13, 2, 9, 5] as const
const ANGLE_OFFSET_2 = 198
const ANGLE_OFFSET_3 = 23
/** The largest value of an 8-bit unsigned normalised channel. */
const BYTE = 255

/** A float32, as a GPU holds one; the sum and the product of two, rounded once each. */
const f32 = Math.fround
const sum = (a: number, b: number) => f32(a + b)
const product = (a: number, b: number) => f32(a * b)

/** The byte a value of `[-1, 1]` is stored as (halved, shifted and rounded to nearest), and the
 *  value read back from it. */
const throughByte = (x: number) =>
  (Math.trunc(sum(product(sum(product(x, 0.5), 0.5), BYTE), 0.5)) / BYTE) * 2 - 1

/**
 * The sixteen directions a 4 × 4 block of pixels turns its samples by, indexed `x + 4 y`: the
 * block's rotation basis in order (`REORDER`) over half a turn, each scaled down by a share that
 * varies with its rank, and stored in a byte a channel, as the texture of the occlusion's noise holds
 * them — each pair `(cos, sin)` read back from its bytes, a value of `[-1, 1]`.
 */
export const AO_RANDOM_BASIS: readonly (readonly [number, number])[] = REORDER.map((w) => {
  const angle = product(product(w, 1 / 16), Math.PI)
  const wobble = Math.sin(product(product(ANGLE_OFFSET_2, w), 0.01))
  const length = f32(
    1 - product(product(sum(product(f32(wobble), 0.5), 0.5), ANGLE_OFFSET_3), 0.01),
  )
  return [
    throughByte(product(f32(Math.cos(angle)), length)),
    throughByte(product(f32(Math.sin(angle)), length)),
  ] as const
})

/** The texels of the noise block along an axis. */
export const AO_BASIS_SIDE = 4
/** The noise texture's side in texels, a multiple of the block's: where the temporal offset wraps. */
export const AO_NOISE_SIDE = 64
/** What a pixel's noise moves by for each image of the temporal sequence, in texels, and the images
 *  of it before it comes round. */
export const AO_TEMPORAL_STEP = [2.48, 7.52] as const
export const AO_TEMPORAL_IMAGES = 8
