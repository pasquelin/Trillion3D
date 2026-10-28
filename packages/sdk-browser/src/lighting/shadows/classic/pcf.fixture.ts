/**
 * THE FILTER OF A CLASSIC SHADOW (`shadowVirtualEnable` off), in the form it is tested in; `pcfWgsl.ts` is its twin in the shaders.
 *
 * A shadow map texel gives the receiver a visibility from the depths of the two (`transitionVisibility`): the receiver's depth against the stored one, the difference
 * made a ramp by the transition scale, so that the shadow fades in from its caster instead of cutting. The visibility of a receiver is those of the 5 by 5 texels around its
 * position, each edge texel weighed by what the position leaves of it (a window of six texels a side, the first and the last weighed by the fraction), a twenty-fifth of their sum; the
 * square of it corrects the filter's blur (`overBlurCorrection`). A cascade fades into the next over the length of its fade (`cascadeBlend`).
 */

/** The visibility one texel of stored depth `stored` gives a receiver at `depth`, both in the map's depth units: 0 where the caster is well in front, 1 where behind, a ramp of the transition `scale` between. */
export const transitionVisibility = (stored: number, depth: number, scale: number) =>
  Math.min(Math.max(stored * scale - (depth * scale - 1), 0), 1)

/** The weights of the six texels a side of a 5 by 5 window along one axis, where the position's fraction between its texel and the next is `fraction`. */
export const pcfWeights = (fraction: number) => [1 - fraction, 1, 1, 1, 1, fraction]

/** The 5 by 5 filter of the 36 visibilities `values` (row by row, from the texel two before the position's to the third after), the fraction of the position `fx`, `fy`. */
export function pcf5x5(fx: number, fy: number, values: ArrayLike<number>) {
  const wx = pcfWeights(fx)
  const wy = pcfWeights(fy)
  let sum = 0
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) sum += values[y * 6 + x]! * wx[x]! * wy[y]!
  return sum * 0.04
}

/** The filter's blur made less: its square. */
export const overBlurCorrection = (visibility: number) => visibility * visibility

/** The weight of a cascade at view depth `depth`: 1 up to its fade plane, falling to 0 over the fade's length (`cascadeRange`'s `fadePlane` and `fadeLength`); 1 where it fades none. */
export const cascadeBlend = (depth: number, fadePlane: number, fadeLength: number) =>
  fadeLength > 0 ? 1 - Math.min(Math.max((depth - fadePlane) / fadeLength, 0), 1) : 1

/** The transition scale a receiver gets: the light's, lowered where the surface turns from the light (`cosine` of its normal with the light's direction, held to 0..1) down to `1 - receiverBias` of it: the ramp grows as the surface grazes. */
export const receiverTransitionScale = (scale: number, receiverBias: number, cosine: number) =>
  scale * (1 - receiverBias + receiverBias * Math.min(Math.max(cosine, 0), 1))
