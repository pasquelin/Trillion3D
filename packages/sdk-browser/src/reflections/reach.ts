/**
 * WHICH LOBES CAST A RAY, AND HOW FAR. A ray is cast for a lobe smooth enough that its reflection
 * shows what the probes' field cannot: a lobe of roughness `r` traces with the share
 * `saturate((REFLECTION_TRACE_ROUGHNESS − r) / REFLECTION_TRACE_FADE)` — whole under 0.3, never past
 * 0.4, the reference engine's bar for a dedicated reflection ray —, the field answering the rest
 * (`reflectionField`, `wgsl.ts`), read through the whole lobe, the two answers blended by the share:
 * the same weights every image, no choice between them for the denoiser to average. A rougher lobe spreads its radiance over the whole hemisphere
 * the probes already gather, so a ray adds noise, not detail.
 *
 * THE HARD BOUND of a ray that traces, the scene's extent: the field's last cascade is world-fixed
 * and covers the proxy's extent (`../bounce/gridWgsl.ts`), so no ray meets anything past its cube's
 * diagonal, √3 · side · s_last; without a field, `REFLECTION_FAR`. It costs nothing: the placement
 * tree's walk stops at the root's box anyway, the bound only keeps the ray finite.
 *
 * Cost of the rule: one square root and a clamp a lobe. What it saves: a lobe past 0.4 neither marches
 * the screen nor walks the proxy, its only cost the field's 8 probes a cascade.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../bounce/gridWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/** `reflectionTraceShare`: the share of a lobe of narrower width `alpha` (α, its roughness squared)
 *  a ray answers, the rest the field's. `reflectionSceneReach`: the hard bound, the last cascade's
 *  diagonal, or `REFLECTION_FAR`. The program declares `bounce` (`BounceGrid`). */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, REFLECTION_CONSTANTS_WGSL],
  `fn reflectionTraceShare(alpha:f32)->f32{
 return saturate((REFLECTION_TRACE_ROUGHNESS-sqrt(alpha))/REFLECTION_TRACE_FADE);
}
fn reflectionSceneReach()->f32{
 if(bounce.counts.w==0u||bounce.counts.y==0u){return REFLECTION_FAR;}
 let last=min(bounce.counts.y,CASCADE_LEVELS)-1u;
 return sqrt(3.0)*f32(bounce.counts.x)*bounce.levels[last].spacing;
}`,
)
