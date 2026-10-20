/**
 * WHICH LOBES CAST A RAY, AND HOW FAR — the reflections' levels of precision: a roughness bar for
 * tracing at all, then tracing tiers by distance.
 *
 * ROUGHNESS. A ray is cast for a lobe smooth enough that its reflection shows what the probes' field
 * cannot: a lobe of roughness `r` traces with the share
 * `saturate((REFLECTION_TRACE_ROUGHNESS − r) / REFLECTION_TRACE_FADE)` — whole under 0.3, never past
 * 0.4 —, the field answering the rest (`reflectionField`, `wgsl.ts`), read through the whole lobe, the
 * two answers blended by the share: the same weights every image, no choice between them for the
 * denoiser to average. A rougher lobe spreads its radiance over the whole hemisphere the probes already
 * gather, so a ray adds noise, not detail; a pixel none of whose lobes traces is no texel of the grid
 * at all (`tiles.ts`). Without a field (no probes bound) the field is the surroundings alone, which an
 * enclosed scene hides: every lobe then traces whole.
 *
 * DISTANCE, by tiers, each coarser and cheaper than the one before: the screen first, the frame itself,
 * for every ray (`reflectionSeen`); then the proxy, the scene's simplified geometry, for the rays the
 * screen left of a pixel in the NEAR FIELD (`reflectionNearField`): inside the cascades that follow the
 * camera — detailed geometry is worth tracing around the camera alone; past them, the
 * probes' field and the surroundings, the coarse far field, for the rest. The near field's bound is the
 * cascades' own, no count of metres: past the levels that follow the camera only the world-fixed level's
 * coarse cells hold the light, the pixels are far and few, and a reflection there takes the screen and the
 * field, a pixel's whole cost the march and eight probes a cascade. Without a field every pixel is near.
 *
 * THE HARD BOUND of a ray the proxy walks, the scene's extent (`reflectionSceneReach`): the field's last
 * cascade is world-fixed and covers the proxy's extent (`../bounce/gridWgsl.ts`), so no ray meets
 * anything past its cube's diagonal, √3 · side · s_last; without a field, `REFLECTION_FAR`. It costs
 * nothing: the placement tree's walk stops at the root's box anyway, the bound only keeps the ray finite.
 *
 * Cost of the rules: one square root and a clamp a lobe, a box test a traced texel. What they save: a
 * lobe past 0.4 neither marches the screen nor walks the proxy, and a pixel past the near field walks
 * no proxy.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../bounce/gridWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/** `reflectionTraceShare`: the share of a lobe of narrower width `alpha` (α, its roughness squared)
 *  a ray answers, the rest the field's; the whole lobe where no probe answers.
 *  `reflectionNearField`: whether `P` lies in the box of the coarsest cascade that follows the camera;
 *  every point where no field or no such cascade stands.
 *  `reflectionSceneReach`: the hard bound, the last cascade's diagonal, or `REFLECTION_FAR`. The program
 *  declares `bounce` (`BounceGrid`). */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, REFLECTION_CONSTANTS_WGSL],
  `fn reflectionTraceShare(alpha:f32)->f32{
 if(bounce.counts.w==0u){return 1.0;}
 return saturate((REFLECTION_TRACE_ROUGHNESS-sqrt(alpha))/REFLECTION_TRACE_FADE);
}
fn reflectionNearField(P:vec3f)->bool{
 let levels=min(bounce.counts.y,CASCADE_LEVELS);
 if(bounce.counts.w==0u||levels<2u){return true;}
 let level=levels-2u;
 let low=bounceLevelLow(level);
 let high=low+f32(bounce.counts.x)*bounce.levels[level].spacing;
 return all(P>=low)&&all(P<=high);
}
fn reflectionSceneReach()->f32{
 if(bounce.counts.w==0u||bounce.counts.y==0u){return REFLECTION_FAR;}
 let last=min(bounce.counts.y,CASCADE_LEVELS)-1u;
 return sqrt(3.0)*f32(bounce.counts.x)*bounce.levels[last].spacing;
}`,
)
