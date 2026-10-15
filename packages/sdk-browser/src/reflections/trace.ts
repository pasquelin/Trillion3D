import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { RECT_SHADING_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import { BOUNCE_GRID_WGSL, bounceBindingsWgsl } from '../bounce/gridWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL, surfaceReflects } from '../scene/surfaceModel.ts'
import { REFLECTION_SIDE } from './constants.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
  TRACE_SCENE_BINDINGS,
} from './traceBindings.ts'
import { REFLECTION_GRID_FORMAT, REFLECTION_RAY_FORMAT } from './grids.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_SPATIAL_WGSL } from './spatialWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'

/**
 * THE REFLECTIONS: A FRESH RAY EVERY PIXEL EVERY IMAGE, SHARED IN SPACE AND TIME, for each pixel's two
 * surfaces — the opaque one, and the transparents' front one (`frontLayer.ts`) — in the image's compute
 * pass, before its lighting. Three kernels a surface, over its grids (`grids.ts`), a thread a pixel:
 *
 * 1. TRACE (`traceSurface`): every pixel whose surface reflects casts one ray a lobe (the base's and the
 *    clear coat's), whatever their roughness, in a direction drawn from its GGX distribution — a
 *    mirror's draws at its centre —, a low-discrepancy sequence turning every image (`sampleWgsl.ts`),
 *    through the one chain (`wgsl.ts`): the screen first (the Hi-Z march, `../gpu/hiz/screenMarch.ts`,
 *    read in the radiance pyramid), on what the screen leaves the run-time proxy (`proxy.ts`, as far as
 *    `reach.ts` lets a ray go), then the probes' field and the environment. It writes the fresh texel —
 *    the radiance and the distance of what answered (`texelWgsl.ts`) — and the ray's direction.
 * 2. SPATIAL (`spatialWgsl.ts`): every pixel averages its ray with its neighbours', each weighed by its
 *    BRDF over its pdf on the pixel's own lobe and by the same-surface test, as far as the lobe's width
 *    at the rays' hits covers the distance between them; every ray first held to its neighbourhood.
 * 3. TEMPORAL (`temporalWgsl.ts`): every pixel blends its fresh radiance with its history reprojected
 *    through the last image's view-projection, rejected by depth and normal, clamped to the fresh
 *    neighbourhood on an image drawn for a move, frozen once a still view's history is full, so the
 *    view settles; and writes its surface's answer: the opaque one weighed on its own reflectance into
 *    the reflection target the resolve reads, the front one where the forward fragments read it. A
 *    transparent behind the front surface casts no ray: it reads the chain without the proxy.
 *
 * DISTANCE. A ray goes as far as the eye can tell it from the next stage, never a count of metres: the
 * screen's march ends at `REFLECTION_STEP_CAP` screen pixels or `REFLECTION_MARCH_STEPS` iterations,
 * its answer fading over the last of either; the proxy's ray ends where the probes' field stands for its
 * lobe within one 8-bit step (`reach.ts`), none at all where the surface's pixel alone is a field cell
 * wide, and never past the field's last cascade, the scene's extent.
 *
 * AGAINST THE REFERENCE ENGINE'S REFLECTIONS, point by point:
 * - Rays: one a pixel at full resolution, as its default; GGX directions every image, its sampling
 *   biased away from the lobe's tail, ours the whole lobe (its tail is the radiance of a small bright
 *   body at the lobe's edge). Its rough surfaces past a roughness read its radiance cache without a ray;
 *   ours trace every lobe, and the field answers past the reach where it holds the lobe — the same
 *   saving, decided by the lobe's footprint against a field cell, never by a roughness threshold.
 * - Spatial: both reweigh a neighbour's ray by BRDF over pdf on the pixel's lobe, its hit distance
 *   held to the pixel's own; its kernel grows with the roughness alone, ours with the lobe's width at
 *   the hit (`reflectionReuseReach`), so a near contact stays sharp; both hold rays to a perceptual
 *   range, its by tone mapping, ours by a variance clamp.
 * - Temporal: both blend a dozen images while anything changes, reject by surface distance and clamp
 *   to the neighbourhood; its history never stops moving, ours averages `REFLECTION_STILL` images of a
 *   still view, then freezes, so the view settles and stops drawing.
 * - Its scene trace reads a surface cache for a hit's lighting, kept from image to image; ours lights the
 *   hit on the proxy this image (`rtRadiance`), its shadow rays within the ray's budget.
 * - Compute only, on the GPU: no indirect list, no counter; one word read back, whether the image
 *   sampled a lobe (`traceSampled`), while the view is unsettled (`settle.ts`).
 *
 * COST. N pixels, R the reflecting ones (opaque and front), K̄ the march's mean iterations, p_miss the
 * share of rays the screen leaves, W̄ their mean walk:
 * - trace: R rays a lobe, each ≤ `REFLECTION_MARCH_STEPS` iterations and ≤ `RAY_WORK` /
 *   `REFLECTION_MOVING_SHARE` units on an image drawn for a move (`RAY_WORK` on a still view's quiet
 *   images), then 8 probes a cascade; spatial: R · `REFLECTION_REUSE_TAPS` texels, depths, normals and
 *   directions; temporal: R · 4 history texels (9 fresh ones on a moved image); N flag reads.
 * - t ≈ R · (K̄ / r_m + p_miss · W̄ / r_w + c_s + c_t), bounded by the view's pixels, never by the scene
 *   nor its lights. A ray a pixel is four times the rays of a 2×2 grid: at 2056×1144 (N = 2 352 064),
 *   whose half grid took 4.2 ms in orbit with the march and the walk most of it, expect about four times
 *   the ray terms, past 10 ms — over the frame's share. What bounds it next, on the GPU and without a
 *   coarser grid: the march at the lobe's own footprint (a wide lobe read in the pyramid at the level its
 *   cone covers, its steps that level's cells), and the walk handed to the field where the lobe's
 *   footprint covers a cell (`reach.ts`, already so). A still view pays it for `REFLECTION_STILL` + 1
 *   images, then nothing. The bench's cut points (`// @cut screen`, `proxy`, `wgsl.ts`; `pick`, here)
 *   split the march from the walk.
 */
export const REFLECTION_TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.lightLists}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.traceOut}) var traceOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${B.raysOut}) var raysOut:texture_storage_2d<${REFLECTION_RAY_FORMAT},write>;
@group(0) @binding(${B.sampled}) var<storage,read_write> traceSampled:u32;
var<workgroup> groupSampled:u32;
/** The fresh texel of pixel \`coord\` on the surface \`layer\` — its lobes' radiance, traced now —, and
 *  its ray's direction written; zero where it does not reflect. */
fn traceTexel(coord:vec2i,layer:u32)->vec4u{
 if(any(vec2f(coord)>=view.viewport.xy)){return vec4u(0u);}
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return vec4u(0u);}
 let own=reflectingPixelAt(layer,coord,flags);
 // @cut pick -> vec4u(bitcast<u32>(own.P.x)) keep: ;
 let traced=reflectionTrace(own.P,own.N,own.V,own.rough,reflectionSampleAt(vec2u(coord),layer));
 textureStore(raysOut,coord,vec4u(rayPack(reflectionDirection),0u,0u,0u));
 return freshPack(traced,reflectionHit);
}
/** One thread a pixel; a workgroup that wrote a texel tells the settle the image sampled a lobe
 *  (\`traceSampled\`, \`settle.ts\`): a flag, never a count — every thread that writes it writes one,
 *  so whatever their order the word read after the barrier, and on the CPU after the image, is one;
 *  no ray waits on another, and no counter is shared. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceSurface(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(all(id.xy<textureDimensions(traceOut))){
  let fresh=traceTexel(vec2i(id.xy),REFLECTION_LAYER);
  textureStore(traceOut,id.xy,fresh);
  if(freshValid(fresh)){groupSampled=1u;}
 }
 let sampled=workgroupUniformLoad(&groupSampled);
 if(lane==0u&&sampled!=0u){traceSampled=1u;}
}`,
  [
    directLightWgsl(),
    STANDARD_LIGHTING_WGSL,
    SURFACE_MODEL_LIGHT_WGSL,
    RECT_SHADING_WGSL,
    LOBES_LIGHTING_WGSL,
    LOBES_DECODE_WGSL,
    REFLECTION_LAYER_WGSL,
    bounceBindingsWgsl(0, B.bounceGrid, B.probes),
    BOUNCE_GRID_WGSL,
    reflectionLightViewWgsl(REFLECTION_GROUP),
    reflectionShareWgsl(REFLECTION_GROUP, true, TRACE_SCENE_BINDINGS),
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_SAMPLE_WGSL,
    REFLECTION_SPATIAL_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    surfaceReflects,
  ],
)
