/**
 * Coplanar depth layers at render time.
 *
 * The compiler stacks the opaque surfaces that share a plane and writes one layer per cluster. Here
 * that layer becomes a depth bias in whole hardware units — units of the depth buffer's own last
 * bit — applied identically on every path: the WebGPU pipeline's `depthBias`, the software raster's
 * integer offset on the packed depth key, and WebGL2's `polygonOffset` units. Nothing is computed
 * per pixel, no vertex moves, and a cluster of layer 0 draws exactly as it did before.
 *
 * Calibration. Two triangulations of one plane interpolate the same geometric depth, so the only
 * thing that separates them is float32 rounding. Measured on the `full-overlap` fixture — the two
 * quads with opposite diagonals — at 1280×720 over three camera angles (15°, 45° and 80° to the
 * surface), three near/far ranges (0.1/100, 0.1/1000, 0.01/1000) and both depth conventions, the
 * two meshes disagree by at most **5 units** on any covered pixel, and by 2 or fewer on more than
 * 99.9 % of them. One layer step is 16 units: a margin of more than three times the worst case,
 * still a relative shift of 16 / 2²³ of the depth value itself, which is far below the distance
 * between any two distinct surfaces (under a tenth of a millimetre at a hundred metres on a
 * 0.1–1000 range).
 *
 * The step was then checked on the scene itself, on the city floor of Emerald Square through the
 * WebGPU path: 8, 16, 32 and 64 units give the same image from 16 upwards on the ground the stage
 * marked (16 vs 32 and 32 vs 64 differ by no pixel at all), while above 16 the bias starts to lift
 * the marked surface over its neighbours — 94 pixels at 32 and 185 more at 64, higher up the image,
 * outside the coplanar ground. Sixteen is the smallest step that dominates the noise without
 * reaching surfaces that legitimately sit above.
 */

/** Hardware depth units one layer moves a cluster towards the camera. See the calibration above. */
export const DEPTH_LAYER_BIAS_UNITS = 16;
/** Layers live in four bits of the cache, so the deepest stack the compiler can describe is 15. */
export const MAX_DEPTH_LAYER = 15;

/** The depth bias of a layer, in hardware units. Negative: a higher layer draws nearer the camera,
 *  which is what wins under a `less` depth test. Every path reads this one function. */
export function depthLayerBias(layer: number | undefined) {
  if (!layer || !Number.isFinite(layer) || layer <= 0) return 0;
  return -Math.min(Math.floor(layer), MAX_DEPTH_LAYER) * DEPTH_LAYER_BIAS_UNITS;
}

/**
 * The same bias applied straight to the bits of a float32 depth, for the software raster, which
 * compares packed integer keys instead of running a depth test. For a depth in [0, 1) the IEEE-754
 * bit pattern grows with the value, so subtracting units is subtracting that many last bits; the
 * result is clamped at zero so a near-plane cluster can never wrap around to the far end.
 */
export function biasedDepthBits(bits: number, layer: number | undefined) {
  const bias = depthLayerBias(layer);
  if (bias === 0) return bits >>> 0;
  return Math.max(0, (bits >>> 0) + bias) >>> 0;
}
