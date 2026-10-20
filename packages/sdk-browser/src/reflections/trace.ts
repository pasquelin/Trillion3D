import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { BOUNCE_GRID_WGSL, bounceBindingsWgsl } from '../bounce/gridWgsl.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { listWgsl } from '../gpu/dispatch/list.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './traceBindings.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_RESOLVE_WGSL } from './resolveWgsl.ts'
import { REFLECTION_BILATERAL_WGSL } from './bilateralWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from './viewLayout.ts'
import { REFLECTION_LOBE_RAYS_WGSL } from './weight.ts'
import { REFLECTION_CLASSIFY_WGSL } from './tiles.ts'
import { reflectionStagesWgsl } from './wgsl.ts'

/**
 * THE REFLECTIONS, BY LEVELS OF PRECISION — stochastic screen-space reflections (Stachowiak 2015)
 * carried past the screen by the proxy and the probes: a fresh ray every grid
 * texel every image where a pixel's lobe is smooth enough to show what the field cannot, resolved at
 * every pixel, shared in space and time; the probes' field alone where none is; for each pixel's two
 * surfaces — the opaque one, and the transparents' front one (`frontLayer.ts`) — in the image's compute
 * passes, before its lighting. A grid texel stands for a block of pixels (`grids.ts`): 2 × 2
 * (`REFLECTION_TRACE_BLOCK`), a quarter of the rays, every pixel resolving its own answer from them. A
 * pixel traces one lobe, its top layer's (`reflectingPixelAt`): its clear coat's where it carries one,
 * its base's elsewhere — the sharpest lobe it shows. The kernels of a surface, a thread a texel, a ray
 * or a pixel, each small enough for the GPU to keep many of its threads in flight — a tile
 * classification, the tracing split into a screen pass, a compaction and a scene pass, then a resolve,
 * a temporal accumulation and a spatial filter:
 *
 * 0. CLASSIFY (`tiles.ts`): a workgroup a tracing tile of `REFLECTION_SIDE`² grid texels writes each
 *    texel's picked pixel — the tile jitter, the four rooks of its 2 × 2 (`reflectionJitter`) — and
 *    whether it traces (`reflectionPixelTraces`: under a roughness of 0.4, or every lobe without
 *    probes), and fills four lists: the tracing tiles and the unused ones, whose ray words a
 *    clear empties (`clearTracing`); the resolve tiles of `REFLECTION_SIDE`² pixels a pixel traces in,
 *    and the clear ones. Every kernel after it is dispatched indirectly over one of the lists, on the GPU
 *    alone: a tile of rough surfaces is no texel of the grid.
 * 1. SCREEN (`traceScreen`): a grid texel casts from its picked pixel where that one traces
 *    (`reflectionTracedPixel`), none where it does not, one ray of the lobe it traces (`reach.ts`: whole
 *    under a roughness of 0.3, none past 0.4, the probes' field answering the rest here, whole), in a
 *    direction drawn among its GGX lobe's visible normals — a mirror's at its centre —, a
 *    low-discrepancy sequence turning every image (`sampleWgsl.ts`), marched on the screen exactly (the
 *    chain's first stage, `wgsl.ts`: the Hi-Z march, `../gpu/hiz/screenMarch.ts`, read in the radiance
 *    pyramid, to the image's edge). It writes the ray's direction and, where the screen answered the
 *    texel whole or its pixel lies past the near field (`reflectionNearField`, the field then answering
 *    the rest here), its fresh texel — the radiance and the distance of what answered (`texelWgsl.ts`).
 *    A ray it left is listed, its partial texel written into the scratch: the workgroup counts its rays
 *    left, one append adds them to the list (`../gpu/dispatch/list.ts`), so the rays that go on sit
 *    side by side.
 * 1′. SCENE (`traceScene`): a thread a ray left, dispatched over the list, indirectly: its ray drawn
 *    again — the same numbers, the same ray —, the run-time proxy (`proxy.ts`, its hit's radiance read,
 *    never lit light by light), then the environment where its walk left the scene, else the probes'
 *    field, the fresh texel written whole.
 * 2. RESOLVE (`resolveWgsl.ts`): every pixel of a resolve tile upsamples the rays of the four texels
 *    around it and averages them with its neighbours', each weighed by its BRDF over its pdf on the
 *    pixel's own lobe and by the same-surface test, as far as the lobe's width at the rays' hits covers
 *    the distance between them.
 * 3. TEMPORAL (`temporalWgsl.ts`): every pixel blends that with its history reprojected from its surface
 *    and from its hit through the last image's view-projection, held to its resolved neighbourhood on
 *    every image, the images it counts for shrinking with how far the clamp moved it,
 *    `REFLECTION_HISTORY` at most; a change elsewhere in the scene neither shortens nor restarts it.
 * 4. BILATERAL (`bilateralWgsl.ts`), over the resolve tiles, its clear over the clear ones: a pixel with
 *    a history keeps it, and averages it with its neighbours' while it counts under two images (the
 *    spatial filter); one without reads the field through its lobes — the opaque
 *    one's base lobe leaving its probes to the opaque resolve, which gathers them with its bounce —;
 *    each writes its surface's answer: the opaque one weighed on its own reflectance
 *    into the reflection target the resolve reads, the front one where the forward fragments read it. A
 *    transparent behind the front surface casts no ray: it reads the probes' field.
 *
 * Every mean is taken in the denoiser's space (`reflectionDenoised`), the same rule for every pixel:
 * no case of motion, resolution or surface chooses between two ways to one result.
 *
 * DISTANCE, by tiers (`reach.ts`): the screen for every ray, its march ending at the image's edge or
 * `REFLECTION_MARCH_STEPS` iterations, its answer taken as far as it is sure (the fades of the image's
 * border and of the radiance pyramid's last level); the proxy for the rest of a ray of a pixel in the
 * near field — inside the cascades that follow the camera —, no further than the surface the screen
 * met, `REFLECTION_PROXY_WORK` units at most; the probes' field and the surroundings past it, and for
 * every ray of a pixel past the near field: a far pixel's reflection costs its march and the field.
 *
 * COST. N pixels, R the rays (one a traced pixel traced this image, one a block, opaque and front), T
 * the tracing tiles, P the pixels of the resolve tiles, K̄ ≤ 50 the march's mean iterations, p_miss the
 * share of near rays whose screen answer is not taken, W̄ ≤ 64 their mean walk in units; r_m, r_w the
 * iterations and units the GPU runs a second:
 * - classify: N flag reads at most, a normal and a lobe word a reflecting pixel, a ray word a texel of a
 *   tracing tile, three atomics a listed tile a list;
 * - screen: 64·T threads, a ray word read each (`reflectionTracedPixel`); R · K̄ march iterations (one
 *   nearest read each, a farthest where the ray is not in front, a plane at the pixel), a 16-byte ray
 *   and a partial texel written for each ray left, one append a workgroup;
 * - scene: a thread a ray left, R · p_miss of them, a 16-byte ray and a partial texel read each;
 *   R · p_miss · W̄ walk units, a proxy hit one read of its radiance, then 8 probes a cascade;
 * - resolve: P · (4 + `REFLECTION_REUSE_TAPS`) ray words and texels, a ray's data a tap; temporal:
 *   P · (8 history texels) and 144 resolved pixels a tile, staged once (`temporalStage`); bilateral: a
 *   pixel one history texel, and `REFLECTION_FILTER_TAPS` to twice as many, with their depths and
 *   normals, where its history counts under two images; a pixel without one its coat's 8 probes a
 *   cascade, the front surface's base too.
 * - t ≈ R · (K̄ / r_m + p_miss · W̄ / r_w) + P · (c_r + c_t + c_b), bounded by the view's pixels —
 *   at most R · (50 / r_m + 64 / r_w) for the rays —, never by the scene nor its lights. Every image
 *   drawn pays it, still or moving.
 */
export const REFLECTION_TRACE_SHADER = wgslProgram(
  `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.lightLists}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.traceOut}) var traceOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${B.partialOut}) var partialOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${B.partialIn}) var partialIn:texture_2d<u32>;
@group(0) @binding(${B.rayDataOut}) var rayDataOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
var<workgroup> pendingCount:atomic<u32>;
var<workgroup> pendingBase:u32;
/** The screen stage of grid texel \`g\` of the surface \`layer\`, cast from the pixel of its block that
 *  traces this image (\`reflectionTracedPixel\`): its ray marched on the screen, its direction written
 *  and, beside it, its surface's depth and its pdf (\`rayDataOut\`),
 *  and its fresh texel where the screen answered it whole, or where the pixel lies past the near field
 *  (\`reflectionNearField\`), the field answering the rest here; otherwise the partial texel written and
 *  the ray left returned — its texel, its rest (over \`REFLECTION_EPSILON\`), bound and hit, each
 *  \`f32\`'s bits —, zero otherwise. A texel whose picked pixel does not trace writes nothing: no kernel
 *  reads a texel its ray word does not trace. */
fn traceScreenTexel(g:vec2u,layer:u32)->vec4u{
 let texel=vec2i(g);
 // The word its writer reads as storage, the one binding of it this kernel has.
 let word=textureLoad(surfaceRays,texel).r;
 if(!reflectionWordTraces(word)){return vec4u(0u);}
 let id=reflectionTracedOf(g,word);
 let coord=vec2i(id);
 let own=reflectingPixelAt(layer,coord,surfaceFlagsAt(coord));
 let ray=reflectionTopRay(own.N,own.V,own.rough,reflectionSampleAt(id,layer));
 // Past the near field the field answers here all the screen left, in the gather of the whole lobe.
 let b=reflectionScreenStage(own.P,own.topN,own.V,ray,!reflectionNearField(own.P));
 textureStore(surfaceRays,texel,vec4u(rayPack(ray.R,word),0u,0u,0u));
 // What the resolve weighs the ray by, beside it: its surface's depth and its pdf.
 let q=lobeAlpha(own.top);
 textureStore(rayDataOut,texel,vec4u(bitcast<u32>(own.z),bitcast<u32>(reflectionRayPdf(own.topN,own.V,q*q,ray.R)),0u,0u));
 let fresh=freshPack(b.radiance,b.hit);
 if(b.rest<=REFLECTION_EPSILON){
  textureStore(traceOut,texel,fresh);
  return vec4u(0u);
 }
 textureStore(partialOut,texel,fresh);
 return vec4u(g.x|(g.y<<16u),bitcast<u32>(b.rest),bitcast<u32>(b.bound),bitcast<u32>(b.hit));
}
/** One thread a grid texel of a tracing tile (\`tiles.ts\`); the rays its group left listed at once, one
 *  atomic a group on the list, the scene stage's dispatch raised to hold them. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceScreen(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 var left=vec4u(0u);
 if(all(id<reflectionGridSize())){left=traceScreenTexel(id,REFLECTION_LAYER);}
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
/** One thread a ray the screen stage left (\`pendingIn\`): its ray drawn again from the same pixel — the
 *  same numbers, the same ray —, traced through the scene from where the screen left it, and its
 *  texel's fresh radiance written whole. */
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
 let ray=reflectionTopRay(own.N,own.V,own.rough,reflectionSampleAt(id,REFLECTION_LAYER));
 let partial=texelRadiance(textureLoad(partialIn,texel,0).xy);
 let b=reflectionSceneStage(own.P,own.topN,ray,ReflectionChain(partial,bitcast<f32>(left.y),bitcast<f32>(left.z),bitcast<f32>(left.w)));
 textureStore(traceOut,texel,freshPack(b.radiance,b.hit));
}`,
  [
    // The lights' struct its group declares: what a proxy hit and a lobe's weight read of them.
    directLightWgsl(),
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
    REFLECTION_RESOLVE_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    REFLECTION_BILATERAL_WGSL,
    REFLECTION_CLASSIFY_WGSL,
    listWgsl({ name: 'pendingOut', group: 0, binding: B.pendingOut, entry: 'vec4u', append: true }),
    listWgsl({ name: 'pendingIn', group: 0, binding: B.pendingIn, entry: 'vec4u', append: false }),
  ],
)
