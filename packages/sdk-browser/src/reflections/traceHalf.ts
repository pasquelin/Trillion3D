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
import { HALF_FORMAT, HALF_TEXEL_WGSL } from './halfTexture.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_UPSAMPLE_WGSL } from './upsampleWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'

/**
 * THE REFLECTIONS' TRACE: EVERY PIXEL A FRESH RAY EVERY IMAGE, for each pixel's two surfaces — the opaque
 * one, and the transparents' front one (`frontLayer.ts`) — in the image's compute pass, before its lighting.
 *
 * 1. TRACE (`traceOpaque`, `traceFront`): one thread a texel of a half-resolution grid over the whole view
 *    (`halfTexture.ts`), a texel a 2×2 block of pixels. It traces the first pixel of its block, in a fixed
 *    order, whose surface reflects — so a block on a silhouette still traces its own surface's pixel —
 *    along the centre of each of its lobes (the base's and the clear coat's: the reflection of the view
 *    about its normal, `reflectionTrace`), through the one chain (`wgsl.ts`): the screen first (the Hi-Z
 *    march, `../gpu/hiz/screenMarch.ts`, read in the radiance pyramid), on what the screen leaves the
 *    run-time proxy (`proxy.ts`, walked as far as `reach.ts` lets a ray go), then the probes' field and
 *    the environment. It writes the texel whole, and which pixel it traced: no budget, no order of tiles,
 *    no answer of an earlier image. A still view gives the same bits every image, and is settled with
 *    the image (`settle.ts`); a moving one is answered whole every image.
 * 2. UPSAMPLE (`upsampleOpaque`, `upsampleFront`, `upsampleWgsl.ts`): every reflecting pixel reads its
 *    four nearest half texels, weighed by depth and normal, and the opaque one weighs the radiance on its
 *    own reflectance into the reflection target the resolve reads; the front one writes its radiance
 *    where the forward fragments read one texel (`forwardTrace`). A transparent behind the front surface
 *    casts no ray: its fragment reads the chain without the proxy (screen, probes, environment).
 *
 * Every surface that reflects is traced, rough ones too: the chain's own stages answer a rough lobe
 * cheaply — the screen reads the radiance pyramid at the lobe's footprint (`footprint.ts`) and gives up
 * its share past the pyramid's top level, the proxy's ray is cut where the field stands for it
 * (`reach.ts`) — so no roughness bound skips the ray: the only bound where the field stands for a ray
 * whole is `REFLECTION_FIELD_ALPHA` (`reach.ts`), applied inside the proxy's stage, ray by ray.
 *
 * AGAINST THE REFERENCE ENGINE'S REFLECTIONS. The same frame shape: rays at a downsampled grid, a
 * screen trace first, then a scene trace, then a radiance cache, and an upsample that rejects
 * neighbours by depth and normal. What differs, and why:
 * - Its rough surfaces above a roughness threshold read its radiance cache without a ray. Ours has no
 *   such threshold: its cache holds radiance at a fine angular resolution, ours an order-2 field per
 *   probe, which would blur a glossy lobe; the field stands for a ray only where the lobe's band-3
 *   response is under one 8-bit step, and then only past the footprint's cell (`reach.ts`).
 * - Its scene trace reads a surface cache for the hit's lighting, kept from frame to frame. Ours lights
 *   the hit on the proxy this image (`rtRadiance`): nothing to age, nothing to restart when a lamp moves.
 * - It picks the traced pixel of a block by a jitter that turns each frame, for its temporal filter.
 *   Ours picks the first reflecting pixel of the block, deterministic: step 1 has no history, and a
 *   silhouette block traces its own surface instead of rejecting it at the upsample.
 * - Its screen trace marches a fixed step count; ours is bounded by the screen distance itself
 *   (`screenMarchBudget`), and every stage hands on only the share it is not sure of.
 * - Compute only, on the GPU: no indirect list, no counter, no read back; the CPU dispatches the four
 *   kernels over the view's size, the two front ones only on an image whose front pass wrote a
 *   reflecting surface.
 * Next steps slot in after the trace, before the upsample, on the same half grid: (2) temporal
 * accumulation with history rejection by the reprojected depth and normal, a texel's jitter turning
 * then; (3) rough lobes sampled about their centre with spatial reuse of the neighbours' rays.
 *
 * COST at 1080p (N = 1920·1080 pixels, N/4 = 518 400 half texels, F the front pixels that reflect):
 * - trace: per half texel, 4 flag loads; per traced texel and lobe (two with a coat), the screen march
 *   K(M) = 4M + 6ℓ + 1 iterations at most, M ≤ `REFLECTION_STEP_CAP` = 256 pixels and ℓ the pyramid's
 *   levels (1091 at 1080p), the footprint's ≤ 2·`REFLECTION_TAPS` level reads; on a screen miss, the
 *   proxy's walk ≤ `RAY_WORK` = 512 units (`../bounce/runtimeLayout.ts`) over a ray no longer than
 *   `reflectionProxyReach`; then 8 probes a cascade, `CASCADE_LEVELS` = 4 at most.
 * - upsample: per pixel 1 flag load, and on a reflecting one 4 half texels, 4 depths, 4 normals.
 * - worst case per half texel: 2·(1091 + 512 units + 32 probes); the worst frame (N + F)/4 of them.
 *   What bounds it: the march by the screen, the walk by `RAY_WORK`, the count by the view's pixels —
 *   never by the scene. Expected frame: t ≈ (N + F)/4 · (c_m·K̄ + p_miss·c_w·W̄) + (N + F)·c_u, with K̄
 *   the mean march, p_miss the share the screen leaves, W̄ the mean walk; at the walk's measured
 *   3.4·10⁹ units a second (M2 class), 1.5 ms holds the frame while p_miss·W̄ ≤ ~9 units a texel.
 */
export const REFLECTION_TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.lightLists}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.bounceGrid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${B.probes}) var probes:texture_2d_array<f32>;
@group(0) @binding(${B.halfOut}) var halfOut:texture_storage_2d<${HALF_FORMAT},write>;
@group(0) @binding(${B.frontHalfOut}) var frontHalfOut:texture_storage_2d<${HALF_FORMAT},write>;
/** The pixel of block \`block\` the surface \`layer\` is traced at: the first that reflects, its rank
 *  in the block plus one; zero where none does. */
fn halfPick(block:vec2u,layer:u32)->u32{
 for(var k=0u;k<4u;k++){
  let id=block*2u+vec2u(k&1u,k>>1u);
  if(any(vec2f(id)>=view.viewport.xy)){continue;}
  if(surfaceReflects(surfaceFlagsAt(layer,vec2i(id)))){return k+1u;}
 }
 return 0u;
}
/** The half texel of block \`block\` on the surface \`layer\`: its lobes' radiance, traced now. */
fn traceTexel(block:vec2u,layer:u32)->vec4u{
 let pick=halfPick(block,layer);
 if(pick==0u){return vec4u(0u);}
 let coord=halfPixel(vec2i(block),pick);
 let flags=surfaceFlagsAt(layer,coord);
 let P=surfacePointAt(layer,coord);
 let normal=surfaceNormalAt(layer,coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(surfaceLobesAt(layer,coord),1.0,N,V,normal.a);}
 return halfPack(reflectionTrace(P,N,V,normal.a),pick);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(halfOut))){return;}
 textureStore(halfOut,id.xy,traceTexel(id.xy,0u));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceFront(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(frontHalfOut))){return;}
 textureStore(frontHalfOut,id.xy,traceTexel(id.xy,1u));
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
    HALF_TEXEL_WGSL,
    REFLECTION_UPSAMPLE_WGSL,
    surfaceReflects,
  ],
)
