/**
 * WHICH LOBES CAST A RAY, AND HOW FAR — the reflections' levels of precision: a roughness bar for
 * tracing at all, then tracing tiers by distance.
 *
 * ROUGHNESS. A ray is cast for a lobe smooth enough that its reflection shows what the probes' field
 * cannot: a lobe of roughness `r` traces with the share
 * `saturate((m − r) / f)` — `m` the roughness past which no ray is cast (`ReflectionView.lobe`, 0.4 by default), `f` the
 * band under it over which the ray gives way (0.1): whole under 0.3, never past 0.4; at the level `'off'` `m` is zero:
 * no lobe traces —, the field answering the rest (`reflectionField`, `wgsl.ts`), read through the whole lobe, the
 * two answers blended by the share: the same weights every image, no choice between them for the
 * denoiser to average. A rougher lobe spreads its radiance over the whole hemisphere the probes already
 * gather, so a ray adds noise, not detail; a pixel none of whose lobes traces is no texel of the grid
 * at all (`tiles.ts`).
 *
 * DISTANCE, by tiers, each coarser and cheaper than the one before: the screen first, the frame itself,
 * for every ray (`reflectionSeen`); then the proxy, the scene's simplified geometry, from where the screen stopped
 * knowing the ray, for every pixel, near or far; then the screen's far trace and the environment.
 *
 * THE RINGS of a ray the proxy walks (`reflectionRingFirst`, `reflectionRingSpan`, `proxy.ts`): the levels' own cubes
 * about the eye, each drawn in by a voxel of `ReflectionView.detail.w` across it, cut the ray into segments,
 * from the finest cube that holds its start by more than a voxel — the finest where none does — to the outermost,
 * each walked on its own budget, from where it enters its cube or where the one before ended; the screen looks again
 * from the outermost cube's exit, pulled back by a share of the trace's length (`reflectionDistantStart`).
 *
 * THE HARD BOUND of a ray the proxy walks, the scene's extent (`reflectionSceneReach`): no ray meets
 * anything past the diagonal of the extent of the placements that wear a proxy (`bounce.reach`,
 * `../bounce/uniform.ts`); without a field, `REFLECTION_FAR`. It costs
 * nothing: the placement tree's walk stops at the root's box anyway, the bound only keeps the ray finite.
 *
 * Cost of the rules: one square root and a clamp a lobe, a few box tests a traced texel. What they save: a
 * lobe past the roughness it traces to neither marches the screen nor walks the proxy.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { rayBoxSpan, rayInverseDirection } from '../../../../math/src/wgsl/geometry.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../bounce/gridWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/** `reflectionTraceShare`: the share of a lobe of narrower width `alpha` (α, its roughness squared)
 *  a ray answers, the rest the field's.
 *  `reflectionLevels`: the levels of cascades the field holds, none where no probe stands;
 *  `reflectionRingVoxel`: the half-width of a voxel of a level's cube, the cube's half-width over the voxels across it;
 *  `reflectionRingSpan`: where the ray from `O` along `R` enters and leaves the cube of a level drawn in by a voxel
 *  (a span whose entry is not below its exit misses): a ring of the scene trace (`proxy.ts`);
 *  `reflectionRingFirst`: the finest level whose cube holds `point` by more than a voxel, the first level where none does;
 *  `reflectionDistantStart`: where the far screen trace starts along the ray from `P` along `R`: where it leaves the
 *  outermost cube, drawn back by `(t − 1) / (2n − 1)` of the trace's length for the `n` steps it jitters over
 *  (`REFLECTION_FAR` where no field stands, the surface itself where the ray never meets the cube).
 *  `reflectionSceneReach`: the hard bound, the scene's diagonal, or `REFLECTION_FAR`. The program
 *  declares `bounce` (`BounceGrid`). */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, REFLECTION_CONSTANTS_WGSL, rayBoxSpan, rayInverseDirection],
  `fn reflectionTraceShare(alpha:f32)->f32{
 return saturate((reflectionView.lobe.x-sqrt(alpha))/reflectionView.lobe.y);
}
fn reflectionLevels()->u32{return select(0u,min(bounce.counts.y,CASCADE_LEVELS),bounce.counts.w!=0u);}
fn reflectionRingWidth(level:u32)->f32{return f32(bounce.counts.x)*bounce.levels[level].spacing;}
fn reflectionRingVoxel(level:u32)->f32{return 0.5*reflectionRingWidth(level)/f32(reflectionView.detail.w);}
fn reflectionRingSpan(level:u32,O:vec3f,R:vec3f)->vec2f{
 let low=bounceLevelLow(level)+vec3f(reflectionRingVoxel(level));
 let high=bounceLevelLow(level)+vec3f(reflectionRingWidth(level)-reflectionRingVoxel(level));
 return rayBoxSpan(low,high,O,rayInverseDirection(R));
}
fn reflectionRingFirst(point:vec3f)->u32{
 let levels=reflectionLevels();
 for(var level=0u;level<levels;level++){
  let low=bounceLevelLow(level);
  let inside=min(point-low,low+vec3f(reflectionRingWidth(level))-point);
  if(min(inside.x,min(inside.y,inside.z))>reflectionRingVoxel(level)){return level;}
 }
 return 0u;
}
fn reflectionDistantStart(P:vec3f,R:vec3f)->f32{
 let levels=reflectionLevels();
 if(levels==0u){return REFLECTION_FAR;}
 let full=reflectionView.reach.w;
 let span=reflectionRingSpan(levels-1u,P,R);
 if(!(span.x<span.y)){return 0.0;}
 let t=min(span.y/full,1.0);
 return max(t+(t-1.0)/f32(2u*reflectionView.detail.z-1u),0.0)*full;
}
fn reflectionSceneReach()->f32{
 if(reflectionLevels()==0u){return REFLECTION_FAR;}
 return bounce.reach.x;
}`,
)
