/**
 * Margins that make the GPU projection conservative, and where they come from.
 *
 * `u = 2⁻²⁴` is the relative half-ulp of single precision: a round-to-nearest moves a value by at
 * most `u` times itself.
 */
const U = 2 ** -24;

/**
 * Factor that bounds the error of a four-term dot product, relative to the sum of those terms'
 * absolute values.
 *
 * Each term `m·x` carries the rounding of `m`, of `x` and of the product, i.e. `3u` relative; the
 * three additions that sum them add at most `3u · Σ|terms|`. The total gap is therefore bounded by
 * `6u · Σ|terms|`, up to second-order terms. The kernel takes **eight**: the margin covers those
 * terms, and an FMA contraction — which the WGSL compiler may do — can only shrink the real
 * error, never grow it past this bound.
 */
export const ERR_K = 8 * U;

/**
 * Cost of rounding the INPUTS of the dot product, relative to the corners' world magnitude.
 *
 * Corners and the anchor each travel as TWO single-precision values, so both represent their
 * original double to within `u²`. The gap `d = (hiCorner − hiAnchor) + (loCorner − loAnchor)` then
 * does only three roundings, each bounded by `u|d|`: a coordinate's input gap is therefore bounded
 * by `3u|d|`, and its share in a dot product by `Σ|m_i| · 3u|d_i|`. The kernel takes **four**
 * `u`: the margin covers second-order terms.
 *
 * World magnitude has left this bound, and that is the whole point of anchoring. A corner carried
 * by a single float would be `x(1 ± u)`, and on an urban model — five-digit coordinates, camera
 * in the street — that error alone widened the conservative rectangle by several texels, until
 * the occlusion test lost all reject power. Relative to the camera and in two words, the terms
 * are on the order of the cluster size, and so is the bound.
 */
export const INPUT_K = 4 * U;

/**
 * Cost of the sole passage from NDC to screen, in texels, relative to the target's largest side:
 * `(v·0.5+0.5)·side` and `(1−(v·0.5+0.5))·side` do only three single-precision roundings, and
 * the subtract-from-1 bounds its own gap by `2u`. Four `u` cover both. The error `v` itself
 * carries already entered `v` before this conversion.
 */
export const SCREEN_SLACK_K = 4 * U;

/**
 * Factor that RAISES the depth bound before it travels to the kernel.
 *
 * Engine depth is reverse-Z: a box is rejected only if its nearest bound is SMALLER than the
 * occluder, so a conservative bound is one that OVERSTATES what the cluster will write — the
 * opposite of the sense it had in forward-Z. Two ulps of margin: the first catches round-to-
 * nearest of the transport, the second is the one `hizNearestBound` already applies in double
 * precision. Single-precision multiplication is monotonic, so an input greater than or equal to
 * the CPU's yields an output greater than or equal to the CPU's.
 */
export const DEPTH_GROW = (1 + 2 ** -23) * (1 + U);

/** A WGSL `f32` literal that carries every significant digit of the constant. */
export const wgslFloat = (value: number) => {
  const text = value.toPrecision(12);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};
