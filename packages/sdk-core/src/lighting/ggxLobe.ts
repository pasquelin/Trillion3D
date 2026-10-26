import { PI } from '../../../math/src/constants.ts'

/**
 * The standard material's GGX lobe on the CPU, in its usual form: the CPU image and the lobe fit
 * of the area-light table (`scripts/dev/ltc-fit.ts`) read it, so a lobe changed on one side is changed
 * on both. The shader writes the distribution with the squared sine of the half vector instead
 * (`standardLighting.ts`): another operation order, the same lobe.
 */

/** The normal distribution at `nh`, the cosine of the half vector to the normal, for α². */
export function ggxDistribution(nh: number, alpha2: number) {
  const denominator = nh * nh * (alpha2 - 1) + 1
  return alpha2 / (PI * denominator * denominator)
}

/** The height-correlated visibility for the view and light cosines `nv`, `nl`, for α², in the
 *  joint approximation the shader takes: each cosine blended toward 1 by α. */
export function ggxVisibility(nv: number, nl: number, alpha2: number) {
  const alpha = Math.sqrt(alpha2),
    gv = nl * (nv * (1 - alpha) + alpha),
    gl = nv * (nl * (1 - alpha) + alpha)
  return 0.5 / (gv + gl + 1e-7)
}
