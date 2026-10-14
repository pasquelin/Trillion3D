import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../bounce/gridWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/**
 * HOW FAR A REFLECTION RAY OF THE PROXY GOES: as far as the eye can tell its answer from the next
 * stage's, never a count of metres. The stage after the proxy is the bounce probes' field
 * (`field.ts`): an order-2 radiance per probe, one probe a cell of `s` metres, read through the
 * lobe's own band attenuations (`reflectionBands`). It stands for the ray where both hold:
 *
 * - ANGULARLY, the lobe is one the order-2 field holds: its GGX band-3 attenuation `a₃(α)` is under
 *   one 8-bit step (1/255) — the share of the lobe's response an order-2 field cannot carry, so a
 *   radiance of contrast one read through the field differs from the same radiance read through the
 *   lobe by under one step. `REFLECTION_FIELD_ALPHA` is the least α where it holds (`fieldAlpha`,
 *   the lobe's own moments integrated here, the same density `reflectionBands` integrates in
 *   closed form). A lobe narrower than that on either axis — a mirror, a glossy floor, a wet road —
 *   is never cut: the field would blur it, an image loss the eye sees.
 * - SPATIALLY, past the distance where the ray's footprint — the surface's own pixel at its depth,
 *   `w`, plus the cone's width there, 2·t·tan θ — covers a field cell: the field holds one radiance
 *   a cell, and a footprint a cell wide averages the proxy's answer over what that cell holds.
 *   `t_eye = (s − w) / (2·tan θ)`, θ the lobe's narrower half-angle (`reflectionConeTangent`),
 *   `s` the spacing of the finest cascade that holds the surface.
 *
 * A surface whose own pixel is already as wide as a cell (`w ≥ s`, far away) casts no ray at all:
 * `t_eye ≤ 0`, the field answers whole (the same two conditions, the second at `t = 0`). Wherever
 * the field holds no cascade at the surface, nothing stands for the ray and it is not cut.
 *
 * THE HARD BOUND, the scene's extent: the field's last cascade is world-fixed and covers the
 * proxy's extent (`../bounce/gridWgsl.ts`), so no ray meets anything past its cube's diagonal,
 * √3 · side · s_last; without a field, `REFLECTION_FAR`. It costs nothing: the placement tree's walk
 * stops at the root's box anyway, the bound only keeps `reach` finite.
 *
 * Cost of the rule: a level loop of `CASCADE_LEVELS` box tests at most, once a ray. What it saves:
 * the walk's work grows with the length of the ray it walks (the tree nodes the ray crosses), so a
 * rough far surface walks `t_eye` metres or none, a mirror walks to the scene's edge, and every ray
 * stays under `RAY_WORK` units whatever its length (`../bounce/runtimeLayout.ts`).
 */

/** The band-3 attenuation of the round GGX lobe of width `alpha`: its density over z = N·L is
 *  z/(1 + k + (k − 1)z)², k = α² (`reflectionBands`), and a₃ = E[P₃(z)], P₃ = (5z³ − 3z)/2, by
 *  Simpson's rule over 4096 intervals — a smooth integrand, its error far under 10⁻⁶ for α ≥ 0.05. */
export function bandThree(alpha: number) {
  const k = alpha * alpha,
    n = 4096
  let mass = 0,
    third = 0
  for (let i = 0; i <= n; i++) {
    const z = i / n,
      g = z / (1 + k + (k - 1) * z) ** 2,
      w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2
    mass += w * g
    third += w * g * 0.5 * (5 * z ** 3 - 3 * z)
  }
  return third / mass
}

/** The least lobe width whose band-3 attenuation is under one 8-bit step: a₃ falls from one (a
 *  mirror) to zero (α = 1, the clamped cosine), bisected to 2⁻²⁰. */
export function fieldAlpha(step = 1 / 255) {
  let lo = 0.05,
    hi = 1
  while (hi - lo > 2 ** -20) {
    const mid = (lo + hi) / 2
    if (bandThree(mid) > step) lo = mid
    else hi = mid
  }
  return hi
}

/** The narrowest lobe the probes' field stands for (`fieldAlpha`). */
export const REFLECTION_FIELD_ALPHA = fieldAlpha()

/**
 * `reflectionFieldSpacing`: the cell of the finest cascade whose cube holds `P`, zero where none
 * does or the field is off. `reflectionSceneReach`: the hard bound, the last cascade's diagonal, or
 * `REFLECTION_FAR`. `reflectionProxyReach`: the length of the proxy's ray from a surface at `P`, its
 * pixel `pixel` metres wide, through a lobe whose narrower width is `alpha` and cone tangent
 * `tangent` (zero: no ray). The program declares `bounce` (`BounceGrid`).
 */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, REFLECTION_CONSTANTS_WGSL],
  `const REFLECTION_FIELD_ALPHA:f32=${wgslF32(REFLECTION_FIELD_ALPHA)};
fn reflectionFieldSpacing(P:vec3f)->f32{
 if(bounce.counts.w==0u){return 0.0;}
 let side=f32(bounce.counts.x);
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let spacing=bounce.levels[level].originSpacing.w;
  let low=bounceLevelLow(level);
  if(all(P>=low)&&all(P<low+vec3f(side*spacing))){return spacing;}
 }
 return 0.0;
}
fn reflectionSceneReach()->f32{
 if(bounce.counts.w==0u||bounce.counts.y==0u){return REFLECTION_FAR;}
 let last=min(bounce.counts.y,CASCADE_LEVELS)-1u;
 return sqrt(3.0)*f32(bounce.counts.x)*bounce.levels[last].originSpacing.w;
}
fn reflectionProxyReach(P:vec3f,alpha:f32,tangent:f32,pixel:f32)->f32{
 let far=reflectionSceneReach();
 if(alpha<REFLECTION_FIELD_ALPHA){return far;}
 let spacing=reflectionFieldSpacing(P);
 if(spacing<=0.0){return far;}
 return clamp((spacing-pixel)/(2.0*max(tangent,1e-6)),0.0,far);
}`,
)
