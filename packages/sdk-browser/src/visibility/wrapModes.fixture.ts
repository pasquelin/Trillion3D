import type { WrapMode } from '../../../sdk-core/src/index.ts'
import { clamp, saturate } from '../../../math/src/scalar/reals.ts'

/**
 * CPU mirror of `wrapAxis`, just above: the two texels a linear filter mixes on an axis of `size`
 * texels, the nearest first, and the weight of the second. Off a period's seam, they are the
 * neighbours the clamp sampler already gives, bounded as it bounds them; on a repeating seam, the
 * sampler's rule mixes the last texel and the first, which folding the coordinate separates —
 * the taps then wrap the period. Two languages, one rule: the shader text is not shared with
 * TypeScript.
 */
export function wrapLinear(t: number, size: number, wrap: WrapMode): [number, number, number] {
  const repeat = wrap === 'repeat'
  const p = wrap === 'mirror' ? t - 2 * Math.floor(t / 2) : 0
  const c = repeat ? t - Math.floor(t) : wrap === 'clamp' ? saturate(t) : p > 1 ? 2 - p : p
  const demi = 0.5 / size
  if (repeat && (c < demi || c > 1 - demi)) {
    const u = c * size + 0.5,
      g = u - Math.floor(u)
    return c < demi ? [0, size - 1, 1 - g] : [size - 1, 0, g]
  }
  const centre = c * size - 0.5,
    bas = Math.floor(centre)
  const borne = (i: number) => clamp(i, 0, size - 1)
  return [borne(bas), borne(bas + 1), centre - bas]
}
