/**
 * WHICH LOBES CAST A RAY, AND HOW FAR — the reflections' levels of precision: a roughness bar for
 * tracing at all, then tracing tiers by distance.
 *
 * ROUGHNESS. A ray is cast for a lobe smooth enough that its reflection shows what the probes' field
 * cannot: a lobe of roughness `r` traces with the share
 * `saturate((m − r) / f)` — `m` the roughness past which no ray is cast (`ReflectionView.lobe`, 0.4 by default; for a pixel of the thin
 * transmission (`SUBSURFACE_FLAG`) and the subsurface model, whatever its colour (`pixelModelOf`), its own bar, `ReflectionView.reach.z`, the level's row), `f` the
 * band under it over which the ray gives way (0.1): whole under 0.3, never past 0.4; at the level `'off'` the view traces
 * nothing (`stageReflections`) —, the field answering the rest (`reflectionField`, `wgsl.ts`), read through the whole lobe, the
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
 * Cost of the rules: one square root and a clamp a lobe, a compare a traced texel. What they save: a
 * lobe past the roughness it traces to neither marches the screen nor the scene.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'

/** `reflectionTraceShare`: the share of a lobe of narrower width `alpha` (α, its roughness squared), of a pixel of surface flags `flags`,
 *  a ray answers, the rest the field's. */
export const REFLECTION_REACH_WGSL = wgslBlock(
  'REFLECTION_REACH_WGSL',
  [REFLECTION_CONSTANTS_WGSL, pixelModelOf],
  `fn reflectionTraceShare(alpha:f32,flags:u32)->f32{
 let foliage=(flags&${SUBSURFACE_FLAG}u)!=0u||pixelModelOf(flags)==${PIXEL_MODEL.subsurface}u;
 let most=select(reflectionView.lobe.x,reflectionView.reach.z,foliage);
 return saturate((most-sqrt(alpha))/reflectionView.lobe.y);
}`,
)

/** `reflectionPixelTraces`: whether the reflecting pixel \`coord\` of flags \`flags\` traces. A pixel that carries a clear coat always does, whatever
 *  its roughness (the new project's blendable layout of the material buffer has no second roughness to test), its ray answering the coat whole
 *  (\`bilateralShares\`); any other where its base lobe answers a share of its rays:
 *  its roughness, biased as the lobe is traced (\`reflectionSmoothed\`), under the roughness a lobe traces to (a foliage pixel's own). The pixel's roughness alone
 *  decides it: the narrower width an anisotropy gives its base lobe, α(1 − s) (\`lobesWgsl.ts\`), is not read here. The lobes are read once, the normal's
 *  roughness only for a pixel that carries no coat. */
export const REFLECTION_PIXEL_TRACES_WGSL = wgslBlock(
  'REFLECTION_PIXEL_TRACES_WGSL',
  [REFLECTION_REACH_WGSL, REFLECTION_SURFACES_WGSL],
  `fn reflectionPixelTraces(coord:vec2i,flags:u32)->bool{
 return surfaceCoatedAt(coord,flags)||reflectionTraceShare(lobeAlpha(reflectionSmoothed(surfaceNormalAt(coord).a)),flags)>0.0;
}`,
)
