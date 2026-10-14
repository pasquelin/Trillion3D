import { FLOAT32_STEP } from '../../../math/src/constants.ts'
import { BOX_PROJECT_WGSL } from '../gpu/core/boxProjectWgsl.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'

/**
 * How much the bound is raised before it is rounded to single precision.
 *
 * Engine depth is REVERSE-Z (`../camera/depthConvention.ts`): a box is hidden only if its nearest bound is
 * SMALLER than the farthest occluder. A safe bound therefore OVERSTATES what the cluster will
 * write. `Math.fround` rounds to nearest: it can **lower** the value by half an ulp, and a bound
 * that drops by one bit is enough to reject a cluster that still paints its pixel. Raising by a
 * whole ulp before rounding definitively flips the sense: for `x > 0`, the product is at least
 * `x(1 + 2⁻²⁴)(1 − 2⁻⁵³)` and its rounding at least `x(1 + 2⁻⁴⁸)(1 − 2⁻⁵³)`, hence strictly
 * more than `x`. One multiplier and one rounding, no per-box bit manipulation.
 */
const GROW = 1 + FLOAT32_STEP / 2

/** The shipped coplanar bias (`biasedDepth`, `../gpu/core/boxProjectWgsl.ts`) run in JavaScript:
 *  an f32 depth moved its layer's hardware units nearer, held at 1.0f. An edit of the kernel is
 *  what the tests bound by. */
const { biasedDepth } = shaderRun<{
  biasedDepth: (value: number, layer: number) => number
}>(BOX_PROJECT_WGSL, ['biasedDepth'], {})

/**
 * Depth bound a box carries to the occlusion kernel: an OVERESTIMATE of what the cluster will
 * write if drawn, in single precision as the kernel reads it.
 *
 * Two gaps separate the box's nearest corner, computed in double, from the depth the GPU will
 * write. The first is transport rounding, corrected by `GROW`. The second is the **coplanar
 * layer bias**: a non-zero-layer cluster is drawn sixteen hardware units per layer closer to the
 * eye, hence nearer than its own corner; `biasedDepth` — the bias the GPU applies — adds exactly
 * those units to the bound's bits. With these two corrections, `nearest < far` implies the
 * cluster is behind everything the pyramid saw, whatever its layer.
 *
 * A null or negative bound is returned as-is: it describes the far, where nothing is drawn, and
 * nothing needs correcting.
 */
export function hizNearestBound(nearest: number, depthLayer: number) {
  if (!(nearest > 0)) return nearest
  const above = Math.fround(nearest * GROW)
  return biasedDepth(above, depthLayer)
}
