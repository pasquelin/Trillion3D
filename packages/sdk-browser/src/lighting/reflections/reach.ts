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
 * screen left of a pixel in the NEAR FIELD (`reflectionNearField`): inside the levels that follow the
 * eye — detailed geometry is worth tracing around the eye alone; past them, the
 * probes' field and the surroundings, the coarse far field, for the rest. The near field's bound is the
 * levels' own, no count of metres: past the coarsest level no probe holds light, the sky light answers, the
 * pixels are far and few, and a reflection there takes the screen and the
 * field, a pixel's whole cost the march and eight probes a level. Without a field every pixel is near.
 *
 * THE RINGS of a ray the proxy walks (`reflectionRingFirst`, `reflectionRingExit`, `proxy.ts`): the levels' own cubes
 * about the eye cut the ray into segments, from the finest cube that holds its start to the outermost, each
 * walked on its own budget, so that the cost of a ray follows its distance, not the density it crosses.
 *
 * THE HARD BOUND of a ray the proxy walks, the scene's extent (`reflectionSceneReach`): no ray meets
 * anything past the diagonal of the extent of the placements that wear a proxy (`bounce.reach`,
 * `../bounce/uniform.ts`); without a field, `REFLECTION_FAR`. It costs
 * nothing: the placement tree's walk stops at the root's box anyway, the bound only keeps the ray finite.
 *
 * Cost of the rules: one square root and a clamp a lobe, a box test a traced texel. What they save: a
 * lobe past 0.4 neither marches the screen nor walks the proxy, and a pixel past the near field walks
 * no proxy.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { rayBoxSpan } from '../../../../math/src/wgsl/geometry.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../bounce/gridWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/** `reflectionTraceShare`: the share of a lobe of narrower width `alpha` (α, its roughness squared)
 *  a ray answers, the rest the field's; the whole lobe where no probe answers.
 *  `reflectionLevelHigh`: the high corner of a level's box, its low corner `bounceLevelLow`'s.
 *  `reflectionNearField`: whether `P` lies in the box of the coarsest level that follows the eye;
 *  every point where no field stands.
 *  `reflectionRingFirst`: the finest of the first `levels` levels whose box holds `O`, `levels` where none does;
 *  `reflectionRingExit`: where the ray from `O`, its direction's reciprocal `inverse`, leaves a level's box: the
 *  end of a ring of the scene trace (`proxy.ts`).
 *  `reflectionSceneReach`: the hard bound, the scene's diagonal, or `REFLECTION_FAR`. The program
 *  declares `bounce` (`BounceGrid`). */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, REFLECTION_CONSTANTS_WGSL, rayBoxSpan],
  `fn reflectionTraceShare(alpha:f32)->f32{
 if(bounce.counts.w==0u){return 1.0;}
 return saturate((REFLECTION_TRACE_ROUGHNESS-sqrt(alpha))/REFLECTION_TRACE_FADE);
}
fn reflectionLevelHigh(level:u32)->vec3f{
 return bounceLevelLow(level)+vec3f(f32(bounce.counts.x)*bounce.levels[level].spacing);
}
fn reflectionNearField(P:vec3f)->bool{
 let levels=min(bounce.counts.y,CASCADE_LEVELS);
 if(bounce.counts.w==0u||levels==0u){return true;}
 let level=levels-1u;
 return all(P>=bounceLevelLow(level))&&all(P<=reflectionLevelHigh(level));
}
fn reflectionRingFirst(O:vec3f,levels:u32)->u32{
 for(var level=0u;level<levels;level++){
  if(all(O>=bounceLevelLow(level))&&all(O<=reflectionLevelHigh(level))){return level;}
 }
 return levels;
}
fn reflectionRingExit(level:u32,O:vec3f,inverse:vec3f)->f32{
 return rayBoxSpan(bounceLevelLow(level),reflectionLevelHigh(level),O,inverse).y;
}
fn reflectionSceneReach()->f32{
 if(bounce.counts.w==0u||bounce.counts.y==0u){return REFLECTION_FAR;}
 return bounce.reach.x;
}`,
)
