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
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_UPSAMPLE_WGSL } from './upsampleWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'

/**
 * THE REFLECTIONS: A FRESH RAY EVERY TEXEL EVERY IMAGE, ACCUMULATED OVER TIME, for each pixel's two
 * surfaces — the opaque one, and the transparents' front one (`frontLayer.ts`) — in the image's compute
 * pass, before its lighting. Three kernels a surface, over its half grids (`halfTexture.ts`):
 *
 * 1. TRACE (`traceOpaque`, `traceFront`): one thread a texel of a half-resolution grid over the whole
 *    view, a texel a 2×2 block of pixels. It traces one pixel of its block whose surface reflects, the
 *    first in a fixed order that turns every image (`halfPick`: the diagonal, then the other one, a turn
 *    of four images), along the centre of each of its lobes (the base's and the clear coat's), through
 *    the one chain (`wgsl.ts`): the screen first (the Hi-Z march, `../gpu/hiz/screenMarch.ts`, read in the
 *    radiance pyramid), on what the screen leaves the run-time proxy (`proxy.ts`, as far as `reach.ts` lets
 *    a ray go), then the probes' field and the environment. It writes the fresh texel whole, the pixel it
 *    traced and the distance of what answered (`texelWgsl.ts`): no budget, no order of tiles.
 * 2. TEMPORAL (`temporalWgsl.ts`): each texel blends its fresh ray with its history reprojected through
 *    the last image's view-projection, rejected by depth and normal, clamped to the fresh neighbourhood
 *    on an image drawn for a change, frozen once a still view's history is full.
 * 3. UPSAMPLE (`upsampleWgsl.ts`): every reflecting pixel reads its four nearest history texels, weighed
 *    by depth and normal; the opaque one weighs the radiance on its own reflectance into the reflection
 *    target the resolve reads, the front one writes its radiance where the forward fragments read one
 *    texel. A transparent behind the front surface casts no ray: it reads the chain without the proxy.
 *
 * Every surface that reflects is traced, rough ones too: the chain's own stages answer a rough lobe
 * cheaply — the screen reads the radiance pyramid at the lobe's footprint (`footprint.ts`) and gives up
 * its share past the pyramid's top level, the proxy's ray is cut where the field stands for it
 * (`reach.ts`, `REFLECTION_FIELD_ALPHA`, ray by ray).
 *
 * AGAINST THE REFERENCE ENGINE'S REFLECTIONS. The same frame shape: rays at a downsampled grid, a
 * screen trace first, then a scene trace, then a radiance cache, a temporal filter that reprojects and
 * rejects, and an upsample that rejects neighbours by depth and normal. What differs, and why:
 * - Its rough surfaces above a roughness threshold read its radiance cache without a ray. Ours has no
 *   such threshold: its cache holds radiance at a fine angular resolution, ours an order-2 field per
 *   probe, which would blur a glossy lobe; the field stands for a ray only where the lobe's band-3
 *   response is under one 8-bit step, and then only past the footprint's cell (`reach.ts`).
 * - Its scene trace reads a surface cache for the hit's lighting, kept from frame to frame. Ours lights
 *   the hit on the proxy this image (`rtRadiance`): nothing to age, nothing to restart when a lamp moves.
 * - Its temporal filter keeps a history of its own view; ours reprojects through the radiance pyramid's
 *   view-projection, the one previous view of the engine, and its history texel carries its surface's
 *   depth and normal, so no previous surface buffer is kept. A mirror reprojects its virtual point.
 *   Its history never stops moving; ours freezes on a still view, so the view settles and stops drawing.
 * - Its screen trace marches a fixed step count; ours is bounded by the screen distance itself
 *   (`screenMarchBudget`), and every stage hands on only the share it is not sure of.
 * - Compute only, on the GPU: no indirect list, no counter, no read back; the CPU dispatches the
 *   kernels over the view's size, the front ones only on an image whose front pass wrote a reflecting
 *   surface.
 *
 * COST at 1080p (N = 1920·1080 pixels, N/4 = 518 400 half texels, F the front pixels that reflect):
 * - trace: per half texel, at most 4 flag loads; per traced texel and lobe (two with a coat), the screen
 *   march K(M) = 4M + 6ℓ + 1 iterations at most, M ≤ `REFLECTION_STEP_CAP` = 256 pixels and ℓ the
 *   pyramid's levels (1091 at 1080p), the footprint's ≤ 2·`REFLECTION_TAPS` level reads; on a screen
 *   miss, the proxy's walk ≤ `RAY_WORK` = 512 units (`../bounce/runtimeLayout.ts`) over a ray no longer
 *   than `reflectionProxyReach`; then 8 probes a cascade, `CASCADE_LEVELS` = 4 at most.
 * - temporal: per texel, its traced pixel's depth and normal, 4 history texels, 9 fresh ones on a
 *   changed image; a frozen texel one copy.
 * - upsample: per pixel 1 flag load, and on a reflecting one 4 history texels.
 * - worst case per half texel: 2·(1091 + 512 units + 32 probes) + 14 texel loads; the worst frame
 *   (N + F)/4 of them. What bounds it: the march by the screen, the walk by `RAY_WORK`, the count by the
 *   view's pixels — never by the scene. Expected frame: t ≈ (N + F)/4 · (c_m·K̄ + p_miss·c_w·W̄ + c_t) +
 *   (N + F)·c_u, with K̄ the mean march, p_miss the share the screen leaves, W̄ the mean walk; at the
 *   walk's measured 3.4·10⁹ units a second (M2 class), 1.5 ms holds the frame while p_miss·W̄ ≤ ~9 units
 *   a texel. The fresh rays stay one a texel: the accumulation is what lets a ray serve twelve images,
 *   not what lowers the count; lowering it would leave texels without a fresh ray, which step 1 removed.
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
 let traced=reflectionTrace(P,N,V,normal.a);
 return freshPack(traced,reflectionHit,pick,0u);
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
    REFLECTION_TEMPORAL_WGSL,
    REFLECTION_UPSAMPLE_WGSL,
    surfaceReflects,
  ],
)
