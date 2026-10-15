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
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './traceBindings.ts'
import { REFLECTION_GRID_FORMAT, REFLECTION_RAY_FORMAT } from './grids.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_SPATIAL_WGSL } from './spatialWgsl.ts'
import { REFLECTION_BILATERAL_WGSL } from './bilateralWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { reflectionShareWgsl } from './weight.ts'

/**
 * THE REFLECTIONS: A FRESH RAY EVERY PIXEL EVERY IMAGE, SHARED IN SPACE AND TIME, for each pixel's two
 * surfaces — the opaque one, and the transparents' front one (`frontLayer.ts`) — in the image's compute
 * pass, before its lighting. Five kernels a surface, over its grids (`grids.ts`), a thread a pixel:
 *
 * 0. CLASSIFY (`tiles.ts`): a workgroup a tile of 8 × 8 pixels lists the tile where one of its pixels
 *    reflects; every kernel after it is dispatched indirectly over the list, on the GPU alone.
 * 1. TRACE (`traceSurface`): every pixel whose surface reflects casts one ray a lobe (the base's and the
 *    clear coat's), whatever their roughness, in a direction drawn among its GGX lobe's visible normals —
 *    a mirror's at its centre —, a low-discrepancy sequence turning every image (`sampleWgsl.ts`),
 *    through the one chain (`wgsl.ts`): the screen first (the Hi-Z march, `../gpu/hiz/screenMarch.ts`,
 *    read in the radiance pyramid, to the image's edge), on what the screen leaves the run-time proxy
 *    (`proxy.ts`, its hit's radiance read, never lit light by light), then the probes' field and the
 *    environment. It writes the fresh texel — the radiance and the distance of what answered
 *    (`texelWgsl.ts`) — and the ray's direction.
 * 2. SPATIAL (`spatialWgsl.ts`): every pixel averages its ray with its neighbours', each weighed by its
 *    BRDF over its pdf on the pixel's own lobe and by the same-surface test, as far as the lobe's width
 *    at the rays' hits covers the distance between them.
 * 3. TEMPORAL (`temporalWgsl.ts`): every pixel blends that with its history reprojected through the last
 *    image's view-projection, rejected by depth and normal, held to its fresh neighbourhood on every
 *    image, the images it counts for shrinking with how far the clamp moved it, frozen once a still
 *    view's history is full, so the view settles.
 * 4. BILATERAL (`bilateralWgsl.ts`): every pixel averages its history with its neighbours' as much as
 *    its own is short, and writes its surface's answer: the opaque one weighed on its own reflectance
 *    into the reflection target the resolve reads, the front one where the forward fragments read it.
 *    A transparent behind the front surface casts no ray: it reads the chain without the proxy.
 *
 * Every mean is taken in the denoiser's space (`reflectionDenoised`), the same rule for every pixel:
 * no case of motion, roughness, resolution or surface chooses between two ways to one result.
 *
 * DISTANCE. A ray goes as far as the eye can tell it from the next stage, never a count of metres: the
 * screen's march ends at the image's edge or `REFLECTION_MARCH_STEPS` iterations, as coarse as the
 * lobe's cone allows; its answer is taken whole as often as it is sure (`reflectionDither`, the fades
 * of the image's border and of the march's last iterations dithered over the images), so the proxy walks
 * for the misses alone, no further than the surface the screen met, `REFLECTION_PROXY_WORK` units at
 * most; it ends where the probes' field stands for its lobe within one 8-bit step (`reach.ts`), and
 * never past the field's last cascade, the scene's extent.
 *
 * COST. N pixels, R the rays (one a lobe of a reflecting pixel, opaque and front), T the tiles listed,
 * K̄ ≤ 50 the march's mean iterations, p_miss the share of rays whose screen answer is not taken, W̄ ≤ 64
 * their mean walk in units; r_m, r_w the iterations and units the GPU runs a second:
 * - classify: N flag reads, two cleared texels a pixel of an unlisted tile, two atomics a listed tile;
 * - trace: 64·T threads; R · K̄ march iterations (one nearest read each, a farthest where the ray is
 *   not in front, a plane at the pixel), R · p_miss · W̄ walk units, a proxy hit one read of its
 *   radiance, then 8 probes a cascade;
 * - spatial: R · `REFLECTION_REUSE_TAPS` texels, depths, normals and directions; temporal: R · (4
 *   history + 21 fresh texels); bilateral: R · `REFLECTION_REUSE_TAPS` history texels where a history
 *   is short, one where it is full.
 * - t ≈ R · (K̄ / r_m + p_miss · W̄ / r_w) + R · (c_s + c_t + c_b), bounded by the view's pixels — at
 *   most R · (50 / r_m + 64 / r_w) for the rays —, never by the scene nor its lights. A still view pays
 *   it for `REFLECTION_STILL` + 1 images, then nothing: its targets are held, no kernel runs.
 */
export const REFLECTION_TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.lightLists}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.traceOut}) var traceOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${B.raysOut}) var raysOut:texture_storage_2d<${REFLECTION_RAY_FORMAT},write>;
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
/** One thread a pixel of a listed tile (\`tiles.ts\`). */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceSurface(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=reflectionTilePixel(tile,local);
 if(any(id>=textureDimensions(traceOut))){return;}
 textureStore(traceOut,id,traceTexel(vec2i(id),REFLECTION_LAYER));
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
    reflectionShareWgsl(REFLECTION_GROUP, true),
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TILES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_SAMPLE_WGSL,
    REFLECTION_SPATIAL_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    REFLECTION_BILATERAL_WGSL,
    surfaceReflects,
  ],
)
