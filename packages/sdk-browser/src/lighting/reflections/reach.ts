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
 * for every ray (`reflectionSeen`); then the scene, marched through the global distance field from where the
 * screen stopped knowing the ray, for every pixel, near or far (`reflectionSceneTrace`, `sceneTrace.ts`); then the screen's
 * far trace, from where the ray leaves the field's outermost clipmap, and the environment.
 *
 * THE HARD BOUND of a ray the scene walks, the scene's extent (`reflectionSceneReach`): no ray meets
 * anything past the diagonal of the extent of the placements (`ReflectionView.reach.z`, written from
 * the bounce cascades' `reach`, `../bounce/uniform.ts`); without probes, `REFLECTION_FAR`. It costs
 * nothing: the march stops at the field's last clipmap anyway, the bound only keeps the ray finite.
 *
 * Cost of the rules: one square root and a clamp a lobe, a compare a traced texel. What they save: a
 * lobe past the roughness it traces to neither marches the screen nor the scene.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/** `reflectionTraceShare`: the share of a lobe of narrower width `alpha` (α, its roughness squared)
 *  a ray answers, the rest the field's.
 *  `reflectionSceneReach`: the hard bound, the scene's diagonal, or `REFLECTION_FAR`. */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionTraceShare(alpha:f32)->f32{
 return saturate((reflectionView.lobe.x-sqrt(alpha))/reflectionView.lobe.y);
}
fn reflectionSceneReach()->f32{return reflectionView.reach.z;}`,
)
