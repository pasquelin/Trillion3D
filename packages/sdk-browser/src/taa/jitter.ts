/**
 * Temporal-antialiasing jitter: where each frame samples its pixels, and the render
 * matrix that applies it.
 *
 * The pass shifts its projection by a fraction of a pixel each frame, on a Halton
 * sequence in bases 2 and 3, over a cycle whose length is a prime number: no power of two of the
 * frame index another random signal follows (a shadow ray's noise frame, a light's rank) beats with
 * it. Temporal accumulation turns that into supersampling. The shift is a translation in clip
 * space: it only reaches the matrix the raster, shading and blend read, never the engine camera —
 * selection, its planes and its screen-error threshold see none of this jitter.
 */
import { halton } from '../../../sdk-core/src/math/primitives/halton.ts'

/** The jitter positions of a frame drawn at the display's size, before the prime: eight. */
const NATIVE_POSITIONS = 8
/** The shortest cycle: the fifth prime, eleven. */
const SHORTEST_CYCLE = 11

/** The smallest prime at or above `n`. */
function primeAtLeast(n: number) {
  for (let candidate = Math.max(2, Math.ceil(n)); ; candidate++) {
    let prime = true
    for (let d = 2; d * d <= candidate && prime; d++) prime = candidate % d !== 0
    if (prime) return candidate
  }
}

/**
 * Jitter phases of a frame drawn `render` pixels wide and shown `display` wide: eight positions
 * per display pixel's worth of render pixel, `8 · (display / render)²` rounded, so every display
 * pixel receives samples of its own, raised to the next prime from eleven — 11 at native size, 17
 * at three quarters, 37 at half. A still frame covers every phase before holding
 * (`taaStillFrames`).
 */
export const upscalePhases = (render: number, display: number) =>
  primeAtLeast(
    Math.max(Math.round(NATIVE_POSITIONS * Math.max(1, (display / render) ** 2)), SHORTEST_CYCLE),
  )

/** Cycle length at the display's size: eleven. */
export const TAA_SAMPLES = upscalePhases(1, 1)

/** Still images a hold needs at least: the shading is stochastic (shadow rays, light samples), so
 *  the uniform average must hold enough draws for its noise to fall to the converged image's:
 *  sixteen left a penumbra visibly grainier. */
const TAA_STILL_DRAWS = 64

/** Holding is legal only after the still average has converged and every phase has contributed
 *  as often as every other: a whole number of cycles, the first to hold `TAA_STILL_DRAWS` draws —
 *  66 at native size, six cycles of eleven; 74 at half, two of 37. */
export const taaStillFrames = (phases: number) => Math.ceil(TAA_STILL_DRAWS / phases) * phases

/**
 * Texture level offset of a frame drawn at `render` pixels per display row of `display`: the
 * material pass's footprint is a render pixel, `log2(render / display)` brings it back to a display
 * pixel, so a texture keeps its native texel density. Zero at native size. No further bias is
 * added: the truth is the native image, and one level finer would show more than it and shimmer.
 */
export const upscaleMipBias = (render: number, display: number) => Math.log2(render / display)

/**
 * Pixel offset for cycle sample `sample` among `phases`, in the pixels the frame is drawn in and
 * centred: each component is in (−0.5, 0.5). Writes `out[0]` and `out[1]`.
 */
export function taaJitter(sample: number, out: Float64Array, phases = TAA_SAMPLES) {
  const index = (sample % phases) + 1
  out[0] = halton(index, 2) - 0.5
  out[1] = halton(index, 3) - 0.5
  return out
}

/**
 * `out` = the view-projection shifted by `(jx, jy)` pixels: a translation added in clip space
 * — `x += 2·jx/width · w`, `y += 2·jy/height · w` —, so the first and second rows of the
 * column-major matrix receive the fourth multiplied by the offset. Zero jitter returns the
 * matrix identical, bit for bit.
 */
export function jitterViewProjection(
  out: Float64Array,
  viewProjection: ArrayLike<number>,
  jx: number,
  jy: number,
  width: number,
  height: number,
) {
  const dx = (2 * jx) / width,
    dy = (2 * jy) / height
  for (let column = 0; column < 4; column++) {
    const at = column * 4,
      w = viewProjection[at + 3]
    out[at] = viewProjection[at] + dx * w
    out[at + 1] = viewProjection[at + 1] + dy * w
    out[at + 2] = viewProjection[at + 2]
    out[at + 3] = w
  }
  return out
}
