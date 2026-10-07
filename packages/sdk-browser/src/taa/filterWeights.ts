/**
 * Weights of the current-frame filter: one per neighbour of the 3×3 window, for a given jitter.
 * Blackman-Harris window over a radius of ONE pixel, centred on the unshifted pixel centre:
 * a neighbour only weighs when this frame's sample is far from the centre, which recentres
 * without softening. They depend only on the jitter, which takes only `TAA_SAMPLES` values: the
 * table is computed once, and never per frame nor per pixel.
 */
import { saturate } from '../../../math/src/scalar/reals.ts'
import { hypot2 } from '../../../math/src/float/hypot.ts'
import { PI } from '../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

/** Nine weights, stored neighbour by neighbour (dy then dx, from −1 to 1), three `vec4f` in the uniform. */
export const TAA_WEIGHTS = 12

/** The four-term Blackman-Harris coefficients, the TypeScript and the WGSL window's alike. */
const BLACKMAN_HARRIS = [0.35875, 0.48829, 0.14128, 0.01168] as const

/** The window on `[0, 1]` of the radius, zero beyond. */
function blackmanHarris(distance: number) {
  const x = saturate(distance) * Math.PI + Math.PI,
    [a0, a1, a2, a3] = BLACKMAN_HARRIS
  return a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x)
}

/** The same window in WGSL, for the still image drawn below the display (`upscaleWgsl.ts`), and
 *  zero from the radius on, where the window keeps six hundred-thousandths. One cosine: with
 *  `c = cos(πd)`, `cos(πd+π) = −c`, `cos 2x = 2c²−1` and `cos 3x = −(4c³−3c)`. */
export const BLACKMAN_HARRIS_WGSL = (() => {
  const [a0, a1, a2, a3] = BLACKMAN_HARRIS.map(wgslF32)
  return wgslBlock(
    'BLACKMAN_HARRIS_WGSL',
    [PI],
    `fn blackmanHarris(d:f32)->f32{
 if(d>=1.0){return 0.0;}
 let c=cos(d*PI);
 return ${a0}+${a1}*c+${a2}*(2.0*c*c-1.0)+${a3}*c*(4.0*c*c-3.0);
}`,
  )
})()

/**
 * Write the nine normalised weights at `out[at..]`, from jitter `(jx, jy)` in pixels. A
 * point that lands at the centre of a pixel of the shifted image would, without jitter, be `jx`
 * columns to the left and `jy` rows lower — NDC goes up as the screen goes down — so the sample
 * is at `(−jx, +jy)` from the centre, and each neighbour `(dx, dy)` at `(dx − jx, dy + jy)`.
 */
export function taaWeights(jx: number, jy: number, out: Float32Array, at: number) {
  let sum = 0,
    k = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++, k++) {
      const w = blackmanHarris(hypot2(dx - jx, dy + jy))
      out[at + k] = w
      sum += w
    }
  for (k = 0; k < 9; k++) out[at + k] /= sum
  for (; k < TAA_WEIGHTS; k++) out[at + k] = 0
  return out
}
