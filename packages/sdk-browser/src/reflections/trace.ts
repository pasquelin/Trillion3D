import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { RECT_SHADING_WGSL } from '../lighting/direct/rectLightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import { BOUNCE_GRID_WGSL, bounceBindingsWgsl } from '../bounce/gridWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL, surfaceReflects } from '../scene/surfaceModel.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { listWgsl } from '../gpu/dispatch/list.ts'
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
import { REFLECTION_LOBE_RAYS_WGSL } from './weight.ts'
import { reflectionStagesWgsl } from './wgsl.ts'

/**
 * THE REFLECTIONS: A FRESH RAY EVERY GRID TEXEL EVERY IMAGE, SHARED IN SPACE AND TIME, for each pixel's
 * two surfaces — the opaque one, and the transparents' front one (`frontLayer.ts`) — in the image's
 * compute passes, before its lighting. A grid texel stands for a block of `REFLECTION_TRACE_BLOCK`²
 * pixels (`grids.ts`), the reference engine's reflections at its high quality: a quarter of the rays,
 * every pixel's answer widened from them last. Six kernels a surface, a thread a texel, a ray or a
 * pixel, each small enough for the GPU to keep many of its threads in flight — the reference engine's
 * split of its reflection tracing into a screen pass, a compaction and a scene pass:
 *
 * 0. CLASSIFY (`tiles.ts`): a workgroup a tile of `REFLECTION_SIDE`² grid texels lists the tile where a
 *    pixel of one of its blocks reflects; every kernel after it is dispatched indirectly over the list,
 *    on the GPU alone.
 * 1. SCREEN (`traceScreen`): a grid texel casts from one reflecting pixel of its block, the block's
 *    reflecting pixels taking turns image after image (`reflectionTracedPixel`), one ray a lobe (the
 *    base's and the clear coat's) smooth enough to trace (`reach.ts`: whole under a roughness of 0.3,
 *    none past 0.4, the probes' field answering the rest here, whole), in a direction drawn among its
 *    GGX lobe's visible normals — a mirror's at its centre —, a low-discrepancy sequence turning every
 *    image (`sampleWgsl.ts`), marched on the screen exactly (the chain's first stage, `wgsl.ts`: the
 *    Hi-Z march, `../gpu/hiz/screenMarch.ts`, read in the radiance pyramid, to the image's edge). It
 *    writes the ray's direction and, where the screen answered the texel whole, its fresh texel — the
 *    radiance and the distance of what answered (`texelWgsl.ts`). A ray it left is listed, its partial
 *    texel written into the scratch: the workgroup counts its rays left, one append adds them to the
 *    list (`../gpu/dispatch/list.ts`), so the rays that go on sit side by side.
 * 1′. SCENE (`traceScene`): a thread a ray left, dispatched over the list, indirectly: each lobe left
 *    drawn again — the same numbers, the same ray —, the run-time proxy (`proxy.ts`, its hit's radiance
 *    read, never lit light by light), then the environment where its walk left the scene, else the
 *    probes' field, the fresh texel written whole.
 * 2. SPATIAL (`spatialWgsl.ts`): a texel averages its ray with its neighbours', each weighed by its
 *    BRDF over its pdf on the texel's own lobe and by the same-surface test, as far as the lobe's width
 *    at the rays' hits covers the distance between them.
 * 3. TEMPORAL (`temporalWgsl.ts`): every texel blends that with its history reprojected through the
 *    last image's view-projection, rejected by depth and normal, held to its fresh neighbourhood on
 *    every image, the images it counts for shrinking with how far the clamp moved it, frozen once a
 *    still view's history is full, so the view settles.
 * 4. BILATERAL (`bilateralWgsl.ts`): every pixel reads the history of the texels around it that saw its
 *    surface, averages it with its neighbours' as much as its own is short, and writes its surface's
 *    answer: the opaque one weighed on its own reflectance into the reflection target the resolve
 *    reads, the front one where the forward fragments read it. A transparent behind the front surface
 *    casts no ray: it reads the probes' field.
 *
 * Every mean is taken in the denoiser's space (`reflectionDenoised`), the same rule for every pixel:
 * no case of motion, roughness, resolution or surface chooses between two ways to one result.
 *
 * DISTANCE. A ray goes as far as the eye can tell it from the next stage, never a count of metres: the
 * screen's march ends at the image's edge or `REFLECTION_MARCH_STEPS` iterations; its answer is taken
 * as far as it is sure (the fades of the image's border and of the radiance pyramid's last level), so
 * the proxy walks for the rest alone, no further than the surface the screen met,
 * `REFLECTION_PROXY_WORK` units at most. A lobe rougher than 0.4 casts no ray: the field answers it
 * whole.
 *
 * COST. N pixels, R the rays (one a lobe under a roughness of 0.4 of a reflecting pixel traced this
 * image, a quarter of them, opaque and front), F the lobes the field alone answers, T the tiles listed,
 * K̄ ≤ 50 the march's mean iterations, p_miss the share of rays whose screen answer is not taken, W̄ ≤ 64
 * their mean walk in units; r_m, r_w the iterations and units the GPU runs a second:
 * - classify: N flag reads at most, two cleared texels a texel of an unlisted tile, three atomics a
 *   listed tile;
 * - screen: 64·T threads, four flag reads each (`reflectionTracedPixel`); R · K̄ march iterations (one
 *   nearest read each, a farthest where the ray is not in front, a plane at the pixel), F · 8 probes a
 *   cascade, a 16-byte ray and a partial texel written for each ray left, one append a workgroup;
 * - scene: a thread a ray left, R · p_miss of them, a 16-byte ray and a partial texel read each;
 *   R · p_miss · W̄ walk units, a proxy hit one read of its radiance, then 8 probes a cascade;
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
@group(0) @binding(${B.partialOut}) var partialOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${B.partialIn}) var partialIn:texture_2d<u32>;
var<workgroup> pendingCount:atomic<u32>;
var<workgroup> pendingBase:u32;
/** Two distances as halves (\`texelHalf\`): a ray's two lobes' bounds or hits. */
fn pendingHalves(d:vec2f)->u32{return texelHalf(d.x)|(texelHalf(d.y)<<16u);}
fn pendingDistances(w:u32)->vec2f{return vec2f(texelDistanceOf(w),texelDistanceOf(w>>16u));}
/** The screen stage of grid texel \`g\` of the surface \`layer\`, cast from the pixel of its block that
 *  traces this image (\`reflectionTracedPixel\`): its lobes' rays marched on the screen, its base ray's
 *  direction written, and its fresh texel where the screen answered it whole; where it did not, the
 *  partial texel written and the ray left returned — its texel, its lobes' rests (never both zero: one
 *  is over \`REFLECTION_EPSILON\`), bounds and hits —, zero otherwise; an empty texel where that pixel
 *  does not reflect, which the spatial reuse rebuilds. */
fn traceScreenTexel(g:vec2u,layer:u32)->vec4u{
 let texel=vec2i(g);
 let id=reflectionTracedPixel(g);
 let coord=vec2i(id);
 let flags=surfaceFlagsAt(coord);
 if(any(vec2f(coord)>=view.viewport.xy)||!surfaceReflects(flags)){
  textureStore(traceOut,texel,vec4u(0u));
  return vec4u(0u);
 }
 let own=reflectingPixelAt(layer,coord,flags);
 let u=reflectionSampleAt(id,layer);
 let base=reflectionBaseRay(own.N,own.V,own.rough,u);
 let b=reflectionScreenStage(own.P,own.N,own.V,base);
 var c=ReflectionChain(vec3f(0.0),0.0,REFLECTION_FAR,REFLECTION_FAR);
 if(lobes.on&&lobes.coat>0.0){c=reflectionScreenStage(own.P,lobes.coatN,own.V,reflectionCoatRay(own.V,u));}
 textureStore(raysOut,texel,vec4u(rayPack(base.R),0u,0u,0u));
 let fresh=freshPack(Reflected(b.radiance,c.radiance),min(b.hit,c.hit));
 if(max(b.rest,c.rest)<=REFLECTION_EPSILON){
  textureStore(traceOut,texel,fresh);
  return vec4u(0u);
 }
 textureStore(partialOut,texel,fresh);
 return vec4u(g.x|(g.y<<16u),pack2x16float(vec2f(b.rest,c.rest)),pendingHalves(vec2f(b.bound,c.bound)),pendingHalves(vec2f(b.hit,c.hit)));
}
/** One thread a grid texel of a listed tile (\`tiles.ts\`); the rays its group left listed at once, one
 *  atomic a group on the list, the scene stage's dispatch raised to hold them. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceScreen(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let id=reflectionTilePixel(tile,groups,local);
 var left=vec4u(0u);
 if(all(id<textureDimensions(traceOut))){left=traceScreenTexel(id,REFLECTION_LAYER);}
 var slot=0u;
 if(left.y!=0u){slot=atomicAdd(&pendingCount,1u);}
 workgroupBarrier();
 if(lane==0u){
  let n=atomicLoad(&pendingCount);
  if(n>0u){pendingBase=pendingOutAppend(n,${REFLECTION_SIDE * REFLECTION_SIDE}u);}
 }
 workgroupBarrier();
 if(left.y!=0u){pendingOut.entries[pendingBase+slot]=left;}
}
/** One thread a ray the screen stage left (\`pendingIn\`): its lobes' rays drawn again from the same
 *  pixel — the same numbers, the same rays —, traced through the scene from where the screen left
 *  them, and its texel's fresh radiance written whole. */
@compute @workgroup_size(${REFLECTION_SIDE * REFLECTION_SIDE})
fn traceScene(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${REFLECTION_SIDE * REFLECTION_SIDE}u);
 if(at>=pendingIn.count){return;}
 let left=pendingIn.entries[at];
 let g=vec2u(left.x&0xffffu,left.x>>16u);
 let texel=vec2i(g);
 let id=reflectionTracedPixel(g);
 let coord=vec2i(id);
 let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));
 let u=reflectionSampleAt(id,REFLECTION_LAYER);
 let rest=unpack2x16float(left.y);
 let bound=pendingDistances(left.z);
 let hit=pendingDistances(left.w);
 let partial=texelReflected(textureLoad(partialIn,texel,0));
 // A lobe the screen answered whole is done; the other alone goes on.
 var b=ReflectionChain(partial.base,rest.x,bound.x,hit.x);
 if(rest.x>REFLECTION_EPSILON){b=reflectionSceneStage(own.P,own.N,reflectionBaseRay(own.N,own.V,own.rough,u),b);}
 var c=ReflectionChain(partial.coat,rest.y,bound.y,hit.y);
 if(rest.y>REFLECTION_EPSILON&&lobes.on&&lobes.coat>0.0){c=reflectionSceneStage(own.P,lobes.coatN,reflectionCoatRay(own.V,u),c);}
 textureStore(traceOut,texel,freshPack(Reflected(b.radiance,c.radiance),min(b.hit,c.hit)));
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
    reflectionStagesWgsl(REFLECTION_GROUP),
    REFLECTION_LOBE_RAYS_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TILES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_SAMPLE_WGSL,
    REFLECTION_SPATIAL_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    REFLECTION_BILATERAL_WGSL,
    surfaceReflects,
    listWgsl({ name: 'pendingOut', group: 0, binding: B.pendingOut, entry: 'vec4u', append: true }),
    listWgsl({ name: 'pendingIn', group: 0, binding: B.pendingIn, entry: 'vec4u', append: false }),
  ],
)
