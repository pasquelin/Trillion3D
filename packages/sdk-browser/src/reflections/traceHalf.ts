import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { RECT_SHADING_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import { BOUNCE_GRID_WGSL } from '../bounce/gridWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL, surfaceReflects } from '../scene/surfaceModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_TRACE_BINDINGS as B, TRACE_SCENE_BINDINGS } from './halfBindings.ts'
import { HALF_FORMAT } from './halfTexture.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_SPATIAL_WGSL } from './spatialWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_UPSAMPLE_WGSL } from './upsampleWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'

/**
 * THE REFLECTIONS: A FRESH RAY EVERY TEXEL EVERY IMAGE, SHARED IN SPACE AND TIME, for each pixel's two
 * surfaces — the opaque one, and the transparents' front one (`frontLayer.ts`) — in the image's compute
 * pass, before its lighting. Four kernels a surface, over its half grids (`halfTexture.ts`):
 *
 * 1. TRACE (`traceOpaque`, `traceFront`): one thread a texel of a half-resolution grid over the whole
 *    view, a texel a 2×2 block of pixels. It traces one pixel of its block whose surface reflects, the
 *    first in a turn of four images (`halfPick`: the diagonal, then the other), along each of its lobes
 *    (the base's and the clear coat's): a mirror along its centre, a glossy lobe in a direction drawn from
 *    its GGX distribution, a low-discrepancy sequence turning every image (`sampleWgsl.ts`), through the
 *    one chain (`wgsl.ts`): the screen first (the Hi-Z march, `../gpu/hiz/screenMarch.ts`, read in the
 *    radiance pyramid), on what the screen leaves the run-time proxy (`proxy.ts`, as far as `reach.ts`
 *    lets a ray go), then the probes' field and the environment. It writes the fresh texel whole: the
 *    pixel it traced, the distance of what answered and its reuse radius (`texelWgsl.ts`).
 * 2. SPATIAL (`spatialWgsl.ts`): a glossy texel averages its ray with its sampled neighbours' on the same
 *    surface, depth and normal weighted, over a radius that grows with the roughness.
 * 3. TEMPORAL (`temporalWgsl.ts`): each texel blends its fresh radiance with its history reprojected
 *    through the last image's view-projection (a mirror by its reflection's virtual point), rejected by
 *    depth and normal, clamped to the fresh neighbourhood on an image drawn for a change, frozen once a
 *    still view's history is full, so the view settles.
 * 4. UPSAMPLE (`upsampleWgsl.ts`): every reflecting pixel reads its four nearest history texels, weighed
 *    by depth and normal; the opaque one weighs the radiance on its own reflectance into the reflection
 *    target the resolve reads, the front one writes its radiance where the forward fragments read one
 *    texel. A transparent behind the front surface casts no ray: it reads the chain without the proxy.
 *
 * DISTANCE. A ray goes as far as the eye can tell it from the next stage, never a count of metres: the
 * screen's reach ends where the lobe's footprint fills the radiance pyramid's top level (`reflectionReach`)
 * and its march at `REFLECTION_STEP_CAP` screen pixels; the proxy's ray ends where the probes' field
 * stands for it within one 8-bit step (`reach.ts`: the lobe's band-3 response under 1/255, and the
 * footprint, the surface's own pixel and the cone's width, a field cell wide), none at all where the
 * surface's pixel alone is a cell wide, and never past the field's last cascade, the scene's extent. The
 * march's steps and the walk's work are not scaled by the pixel's footprint: a far mirror reflects a far
 * mountain as sharply as a near one, and a shortened march or walk would hand that reflection to a
 * coarser stage, an image loss the eye sees; what a far rough surface saves is the ray's length.
 *
 * AGAINST THE REFERENCE ENGINE'S REFLECTIONS. The same frame shape: rays at a downsampled grid, GGX
 * samples, a screen trace first, then a scene trace, then a radiance cache, a spatial reconstruction, a
 * temporal filter that reprojects and rejects, an upsample that rejects neighbours. What differs, and why:
 * - Its rough surfaces above a roughness threshold read its radiance cache without a ray. Ours has no
 *   such threshold: its cache holds radiance at a fine angular resolution, ours an order-2 field per
 *   probe, which would blur a glossy lobe; the field stands for a ray only where it holds the lobe.
 * - Its samples are thin rays; ours keep half the lobe's width as their cone (`REFLECTION_SAMPLE_CONE`),
 *   read pre-filtered in the radiance pyramid and the field: fewer samples reach the same lobe.
 * - Its scene trace reads a surface cache for the hit's lighting, kept from frame to frame. Ours lights
 *   the hit on the proxy this image (`rtRadiance`): nothing to age, nothing to restart when a lamp moves.
 * - Its temporal filter keeps a history of its own view; ours reprojects through the radiance pyramid's
 *   view-projection, the one previous view of the engine, and its history texel carries its surface's
 *   depth and normal, so no previous surface buffer is kept. Its history never stops moving; ours
 *   freezes on a still view, so the view settles and stops drawing.
 * - Its screen trace marches a fixed step count; ours is bounded by the screen distance itself
 *   (`screenMarchBudget`), and every stage hands on only the share it is not sure of.
 * - Compute only, on the GPU: no indirect list, no counter, no read back; the CPU dispatches the
 *   kernels over the view's size, the front ones only on an image whose front pass reflected.
 *
 * COST at 1080p (N = 1920·1080 pixels, N/4 = 518 400 half texels, F the front pixels that reflect):
 * - trace: per half texel, at most 4 flag loads; per traced texel and lobe (two with a coat), the screen
 *   march K(M) = 4M + 6ℓ + 1 iterations at most, M ≤ `REFLECTION_STEP_CAP` = 256 pixels and ℓ the
 *   pyramid's levels (1091 at 1080p), the footprint's ≤ 2·`REFLECTION_TAPS` level reads; on a screen
 *   miss, the proxy's walk ≤ `RAY_WORK` = 512 units (`../bounce/runtimeLayout.ts`) over a ray no longer
 *   than `reflectionProxyReach`; then 8 probes a cascade, `CASCADE_LEVELS` = 4 at most.
 * - spatial: per glossy texel, `REFLECTION_REUSE_TAPS` = 8 neighbours, each a texel, a depth, a normal.
 * - temporal: per texel, its traced pixel's depth and normal, 4 history texels, 9 fresh ones on a
 *   changed image; a frozen texel one copy.
 * - upsample: per pixel 1 flag load, and on a reflecting one 4 history texels.
 * - worst case per half texel: 2·(1091 + 512 units + 32 probes) + 24 + 15 texel loads, per pixel 5 + 4;
 *   the worst frame (N + F)/4 texels. What bounds it: the march by the screen, the walk by `RAY_WORK`,
 *   the count by the view's pixels — never by the scene. Expected frame: t ≈ (N + F)/4 · (c_m·K̄ +
 *   p_miss·c_w·W̄ + c_s + c_t) + (N + F)·c_u, with K̄ the mean march, p_miss the share the screen leaves,
 *   W̄ the mean walk; at the walk's measured 3.4·10⁹ units a second (M2 class), 1.5 ms holds the frame
 *   while p_miss·W̄ ≤ ~9 units a texel. The fresh rays stay one a texel: the history and the reuse are
 *   what let a ray serve many pixels and images, not what lowers the count; fewer would leave texels
 *   without a fresh ray, the stale tiles step 1 removed.
 */
export const REFLECTION_TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.lightLists}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.bounceGrid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${B.probes}) var probes:texture_2d_array<f32>;
@group(0) @binding(${B.traceOut}) var traceOut:texture_storage_2d<${HALF_FORMAT},write>;
/** The pixel of block \`block\` the surface \`layer\` is traced at this image: the first that reflects in
 *  the image's turn of the block — the diagonal, then the other —, its rank in the block plus one; zero
 *  where none does. */
fn halfPick(block:vec2u,layer:u32)->u32{
 let turn=reflectionView.temporal.x;
 for(var k=0u;k<4u;k++){
  let rank=(4u-((turn+k)&3u))&3u;
  let id=block*2u+vec2u(rank&1u,rank>>1u);
  if(any(vec2f(id)>=view.viewport.xy)){continue;}
  if(surfaceReflects(surfaceFlagsAt(vec2i(id)))){return rank+1u;}
 }
 return 0u;
}
/** The fresh texel of block \`block\` on the surface \`layer\`: its lobes' radiance, traced now. */
fn traceTexel(block:vec2u,layer:u32)->vec4u{
 let pick=halfPick(block,layer);
 if(pick==0u){return vec4u(0u);}
 let coord=halfPixel(vec2i(block),pick);
 let flags=surfaceFlagsAt(coord);
 let P=surfacePointAt(layer,coord);
 let normal=surfaceNormalAt(coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(surfaceLobesAt(coord),1.0,N,V,normal.a);}
 let traced=reflectionTrace(P,N,V,normal.a,reflectionSampleAt(block,layer));
 // A sampled lobe's ray is shared with the neighbours a rougher one reaches; a mirror's is its own.
 let reach=min(REFLECTION_REUSE_RADIUS,u32(ceil(f32(REFLECTION_REUSE_RADIUS)*normal.a)));
 return freshPack(traced,reflectionHit,pick,select(0u,reach,reflectionSampled(lobeAlpha(normal.a))));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(traceOut))){return;}
 textureStore(traceOut,id.xy,traceTexel(id.xy,0u));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceFront(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(traceOut))){return;}
 textureStore(traceOut,id.xy,traceTexel(id.xy,1u));
}`,
  [
    directLightWgsl(),
    STANDARD_LIGHTING_WGSL,
    SURFACE_MODEL_LIGHT_WGSL,
    RECT_SHADING_WGSL,
    LOBES_LIGHTING_WGSL,
    LOBES_DECODE_WGSL,
    BOUNCE_GRID_WGSL,
    reflectionLightViewWgsl(REFLECTION_GROUP),
    reflectionShareWgsl(REFLECTION_GROUP, true, TRACE_SCENE_BINDINGS),
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_SAMPLE_WGSL,
    REFLECTION_SPATIAL_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    REFLECTION_UPSAMPLE_WGSL,
    surfaceReflects,
  ],
)
