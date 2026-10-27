import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { directLightWgsl } from '../../direct/lightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../../direct/lobesWgsl.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './traceBindings.ts'
import { REFLECTION_GRID_FORMAT } from '../grids.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from '../texelWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from '../temporalWgsl.ts'
import { REFLECTION_RESOLVE_WGSL } from '../resolveWgsl.ts'
import { REFLECTION_BILATERAL_WGSL } from '../bilateralWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from '../sampleWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from '../surfacesWgsl.ts'
import { reflectionCensusWgsl } from '../censusWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../viewLayout.ts'
import { REFLECTION_LOBE_RAYS_WGSL } from '../weight.ts'
import { REFLECTION_CLASSIFY_WGSL } from '../tiles.ts'
import { reflectionStagesWgsl } from '../wgsl.ts'
import { REFLECTION_SCENE_TRACE_WGSL } from '../sceneTrace.ts'
import { REFLECTION_SCENE_TRACE_HARDWARE_WGSL } from '../sceneTraceHardware.ts'
import { isFirstPerson } from '../../../materials/surface/surfaceModel.ts'

/** The counting of the rays (`reflectionStatistics`): the two stages' tallies, which the kernels hold only where the project asks. */
const COUNTING = `/** The screen stage's tally of a ray (\`reflectionCensus\`): a hit of the screen, which answers it whole, or a miss left to the
 *  scene stage. */
fn countScreen(hit:bool){
 tallyAdd(select(REFLECTION_CENSUS_LEFT,REFLECTION_CENSUS_SCREEN,hit),1u);
}
/** The scene stage's tally of a ray: how its march through the field ended, and the steps it took where
 *  it marched. */
fn countScene(){
 tallyAdd(REFLECTION_CENSUS_FATES+reflectionFate,1u);
 if(reflectionFate!=REFLECTION_FATE_NO_FIELD&&reflectionFate!=REFLECTION_FATE_BOUND){
  tallyAdd(REFLECTION_CENSUS_WORK+censusWorkBucket(reflectionWork),1u);
 }
}`

/** The bindings, the workgroup's counters and the census the kernels share. */
const traceDeclarations = (
  statistics: boolean,
) => `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.traceOut}) var traceOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
var<workgroup> pendingCount:atomic<u32>;
var<workgroup> pendingBase:u32;
/** The two numbers a texel's ray is drawn from: the blue noise at the grid texel \`g\` and the image's turn. */
fn reflectionSampleAt(g:vec2u)->vec2f{return blueNoiseVec2(g,reflectionView.temporal.x);}
/** The ray the pixel \`own\` casts, drawn from \`u\`: the lobe it traces sampled (\`reflectionTopRay\`, through its top layer's
 *  roughness), a mirror's — a roughness under a thousandth — its reflection about its normal, no draw. */
fn reflectionCastRay(own:ReflectingPixel,u:vec2f)->ReflectionLobeRay{
 var ray=reflectionTopRay(own.N,own.V,own.top,u);
 if(own.top<0.001){ray.R=reflect(-own.V,own.topN);}
 return ray;
}
/** The cone angle of the ray \`ray\` the pixel \`own\` casts: the inverse of the pdf of the ray it was drawn as
 *  (\`reflectionRayCone\`), the smallest angle for a mirror, whose ray is drawn from no distribution. */
fn reflectionCastCone(own:ReflectingPixel,ray:ReflectionLobeRay)->f32{
 if(own.top<0.001){return REFLECTION_MIN_CONE;}
 return reflectionRayCone(own.topN,own.V,ray.axis.xyz,vec2f(ray.along,ray.alpha),ray.R);
}
/** The ray of grid texel \`texel\` as the ray generation stored it, read as the storage it is written through: the lobe ray of its direction (unit again, the
 *  halves holding it to a thousandth, and read through the thin lobe \`lobeAlpha(0.0)\`, the only part of the lobe a stage reads), its cone angle and
 *  whether its pixel is a first-person object's. */
struct ReflectionStoredRay{ray:ReflectionLobeRay,cone:f32,firstPerson:bool,}
fn reflectionStoredRay(texel:vec2i)->ReflectionStoredRay{
 let r=reflectionRayOf(textureLoad(surfaceRays,texel,REFLECTION_RAY_DIRECTION).r,textureLoad(surfaceRays,texel,REFLECTION_RAY_CONE).r);
 return ReflectionStoredRay(ReflectionLobeRay(normalize(r.xyz),vec4f(0.0,0.0,0.0,lobeAlpha(0.0)),0.0,0.0),abs(r.w),r.w<0.0);
}
${statistics ? COUNTING : ''}`

/** The ray generation: the kernel \`generateRays\` and the texel it casts. */
const generateRaysWgsl =
  () => `/** The ray generation of grid texel \`g\` of the surface \`layer\`: the pixel of its block this image picks (\`reflectionPickedPixel\`) casts a ray where its
 *  lobe traces (\`reflectionPixelTraces\`) — its direction drawn, its cone angle the inverse of its pdf, negative for a pixel of a first-person
 *  object — and the texel keeps the pixel's depth beside it; otherwise the texel keeps the pixel's depth negated, no ray. */
fn generateTexel(g:vec2u,layer:u32){
 let texel=vec2i(g);
 let coord=vec2i(reflectionPickedPixel(g));
 let flags=surfaceFlagsAt(coord);
 if(surfaceReflects(flags)&&reflectionPixelTraces(coord,flags)){
  let own=reflectingPixelAt(layer,coord,flags);
  let ray=reflectionCastRay(own,reflectionSampleAt(g));
  let cone=reflectionCastCone(own,ray);
  let words=reflectionRayWords(ray.R,select(cone,-cone,isFirstPerson(own.flags)));
  textureStore(surfaceRays,texel,REFLECTION_RAY_DIRECTION,vec4u(words.x,0u,0u,0u));
  textureStore(surfaceRays,texel,REFLECTION_RAY_CONE,vec4u(words.y,0u,0u,0u));
  textureStore(surfaceRays,texel,REFLECTION_RAY_DEPTH,vec4u(bitcast<u32>(own.z),0u,0u,0u));
 }else{
  textureStore(surfaceRays,texel,REFLECTION_RAY_DEPTH,vec4u(bitcast<u32>(-surfaceDepthAt(layer,coord)),0u,0u,0u));
 }
}
/** One thread a grid texel of a tracing tile (\`tiles.ts\`). */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn generateRays(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 if(all(id<reflectionGridSize())){generateTexel(id,REFLECTION_LAYER);}
}`

/** The screen stage: the kernel `traceScreen` and the texel it casts. */
const traceScreenWgsl = (
  statistics: boolean,
) => `/** A ray the screen stage missed: its pending entry — its texel and the distance its miss reached — and whether there is one. */
struct ReflectionMissed{entry:vec2u,missed:bool,}
/** The screen stage of grid texel \`g\` of the surface \`layer\`, cast from the pixel of its block the ray generation picked
 *  (\`reflectionPickedPixel\`) along the ray it stored (\`reflectionStoredRay\`): marched on the screen, its fresh texel written where the screen hit;
 *  otherwise the ray missed, returned as its pending entry. A texel whose picked pixel casts no ray (its depth negative) writes nothing: no kernel
 *  reads a texel that traces none. */
fn traceScreenTexel(g:vec2u,layer:u32)->ReflectionMissed{
 let texel=vec2i(g);
 // The depth its writer reads as storage, the one binding of it this kernel has.
 if(!reflectionRayTraces(bitcast<f32>(textureLoad(surfaceRays,texel,REFLECTION_RAY_DEPTH).r))){return ReflectionMissed(vec2u(0u),false);}
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPixelAt(layer,coord,surfaceFlagsAt(coord));
 let b=reflectionScreenStage(own.P,own.topN,own.V,reflectionStoredRay(texel).ray,g);
 ${statistics ? 'countScreen(b.hit);' : ''}
 if(b.hit){
  textureStore(traceOut,texel,freshPack(b.radiance,b.distance));
  return ReflectionMissed(vec2u(0u),false);
 }
 return ReflectionMissed(vec2u(g.x|(g.y<<16u),bitcast<u32>(b.distance)),true);
}
/** One thread a grid texel of a tracing tile (\`tiles.ts\`); the rays its group missed listed at once, one
 *  atomic a group on the list, the scene stage's dispatch raised to hold them. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceScreen(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 var missed=ReflectionMissed(vec2u(0u),false);
 if(all(id<reflectionGridSize())){missed=traceScreenTexel(id,REFLECTION_LAYER);}
 var slot=0u;
 if(missed.missed){slot=atomicAdd(&pendingCount,1u);}
 // The barrier also orders the group's adds to \`pendingCount\` (the tally's flush holds it).
 ${statistics ? 'flushTally(lane);' : 'workgroupBarrier();'}
 if(lane==0u){
  let n=atomicLoad(&pendingCount);
  if(n>0u){pendingBase=pendingOutAppend(n,${REFLECTION_SIDE * REFLECTION_SIDE}u);}
 }
 workgroupBarrier();
 if(missed.missed){pendingOut.entries[pendingBase+slot]=missed.entry;}
}`

/** The scene stage: the kernel `traceScene` and the ray it marches. */
const traceSceneWgsl = (
  statistics: boolean,
  hardware: boolean,
) => `/** The ray the screen stage missed, \`missed\`: the ray the ray generation stored for its texel, marched through the scene from where the
 *  screen stopped knowing it, and its texel's fresh radiance written whole. Its cone angle, which dithers the march's step, is the
 *  inverse of its pdf. A pixel of a first-person object (the stored cone's sign) casts a ray that does not meet the stand-ins of
 *  first-person objects (\`ST_MEET_WORLD_SPACE\`). */
fn traceSceneRay(missed:vec2u){
 let g=vec2u(missed.x&0xffffu,missed.x>>16u);
 let texel=vec2i(g);
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));
 // The ray the ray generation stored, read as the storage the screen stage reads it through.
 let stored=reflectionStoredRay(texel);
 let b=reflectionSceneStage(own.P,own.topN,stored.ray,bitcast<f32>(missed.y),g,stored.cone,stored.firstPerson);
 textureStore(traceOut,texel,freshPack(${hardware ? 'makeFinite3(b.radiance)' : 'b.radiance'},b.distance));
 ${statistics ? 'countScene();' : ''}
}
/** One thread a ray the screen stage missed (\`pendingIn\`); the workgroup's tally flushed after its
 *  rays. */
@compute @workgroup_size(${REFLECTION_SIDE * REFLECTION_SIDE})
fn traceScene(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u${statistics ? ',@builtin(local_invocation_index) lane:u32' : ''}){
 let at=flatIndex(thread,groups,${REFLECTION_SIDE * REFLECTION_SIDE}u);
 if(at<pendingIn.count){traceSceneRay(pendingIn.entries[at]);}
 ${statistics ? 'flushTally(lane);' : ''}
}`

/**
 * THE REFLECTIONS, BY LEVELS OF PRECISION — stochastic screen-space reflections (Stachowiak 2015)
 * carried past the screen by the global distance field and the surface cache: a fresh ray every grid
 * texel every image where a pixel's lobe is smooth enough to show what the screen probes' rough light cannot, resolved at
 * every pixel, shared in space and time; the environment for the share of a lobe no ray answers, and alone where none is, the rest being the screen probes'; for each pixel's two
 * surfaces — the opaque one, and the transparents' front one (`../frontLayer.ts`) — in the image's compute
 * passes, before its lighting. A grid texel stands for a block of pixels (`../grids.ts`): one pixel at the default level,
 * 2 × 2 at the level `high` (`ReflectionView.grid`), a quarter of the rays, every pixel resolving its own answer from them. A
 * pixel traces one lobe, its top layer's (`reflectingPixelAt`): its clear coat's where it carries one,
 * its base's elsewhere — the sharpest lobe it shows. The kernels of a surface, a thread a texel, a ray
 * or a pixel, each small enough for the GPU to keep many of its threads in flight — a tile
 * classification, the generation of the rays, the tracing split into a screen pass, a compaction and a scene pass, then a resolve,
 * a temporal accumulation and a spatial filter:
 *
 * 0. CLASSIFY (`../tiles.ts`): a workgroup a tracing tile of `REFLECTION_SIDE`² grid texels reads each
 *    texel's block for whether a pixel of it traces (`reflectionPixelTraces`: under a roughness of 0.4, or a clear coat whatever the roughness), and fills four lists: the tracing tiles and the unused ones, whose rays a
 *    clear empties (`clearTracing`); the resolve tiles of `REFLECTION_SIDE`² pixels a pixel traces in,
 *    and the clear ones. Every kernel after it is dispatched indirectly over one of the lists, on the GPU
 *    alone: a tile of rough surfaces is no texel of the grid.
 * 0′. GENERATE RAYS (`generateRays`): a grid texel of a tracing tile picks the pixel of its block this image casts from — the tile jitter, the
 *    rooks of its block (`reflectionJitter`, `reflectionPickedPixel`) — and, where that one traces (`reflectionPixelTraces`), draws one whole ray of the lobe it
 *    traces (`../reach.ts`: the lobe's share of it from the last pass, whole under a roughness of 0.3, none past 0.4), in a
 *    direction drawn among its GGX lobe's visible normals — a mirror's at its centre —, a
 *    blue noise read at its texel and the image's turn (`reflectionSampleAt`, `../sampleWgsl.ts`). It writes the ray's direction and its cone angle (the
 *    inverse of its pdf, at least `REFLECTION_MIN_CONE`, negative for a pixel of a first-person object) and the picked pixel's depth beside them, negated where the pixel
 *    casts none (`../grids.ts`): the one place a ray is drawn, the stages after it read it. The distance a ray goes is the view's longest ray
 *    (`ReflectionView.march.w`), whatever the pixel's roughness: the reflections reuse no radiance cache that would shorten it.
 * 1. SCREEN (`traceScreen`): a grid texel casts its stored ray (`reflectionStoredRay`) from its picked pixel where that one traces
 *    (a positive depth), none where it does not, marched on the screen exactly (the
 *    chain's first stage, `../wgsl.ts`: the Hi-Z march, `../../../visibility/hiz/gpu/screenMarch.ts`, read in the last lit
 *    image, to the image's edge or where it gave the ray up). It writes, where the screen hit, the
 *    texel's fresh texel — the radiance and the distance of what answered (`../texelWgsl.ts`).
 *    A ray it missed is listed with the distance its miss reached: the workgroup counts its rays
 *    missed, one append adds them to the list (`../../../gpu/dispatch/list.ts`), so the rays that go on sit
 *    side by side.
 * 1′. SCENE (`traceScene`): a thread a ray missed, dispatched over the list, indirectly: its stored ray, marched through the global distance field from where the screen stopped
 *    knowing the ray, the light of the surface it meets read in the surface cache's final lighting (`../sceneTrace.ts`,
 *    `../../surfaceCache/hitWgsl.ts`, never lit light by light), then, where its march left the scene, the screen's far trace and the
 *    environment, else the environment as well, the fresh texel written whole.
 * 2. RESOLVE (`../resolveWgsl.ts`): every pixel of a resolve tile upsamples the rays of the four texels
 *    around it and averages them with its neighbours', each weighed by its BRDF over its pdf on the
 *    pixel's own lobe, over a radius that grows with the pixel's roughness.
 * 3. TEMPORAL (`../temporalWgsl.ts`): every pixel blends that with its history reprojected from its surface
 *    and from its hit through the last image's view-projection, held to its resolved neighbourhood on
 *    every image, the images it counts for shrinking with how far the clamp moved it,
 *    the history's images at most; a change elsewhere in the scene neither shortens nor restarts it.
 * 4. BILATERAL (`../bilateralWgsl.ts`), over the resolve tiles, its clear over the clear ones: a pixel with
 *    a history keeps it, and averages it with its neighbours' while it counts under two images (the
 *    spatial filter); one without reads the environment through its lobes — the opaque
 *    one's base lobe leaving its rough light to the opaque resolve, which reads the screen probes' with its bounce —;
 *    each writes its surface's answer: the ray's share of each lobe and the environment's for the rest, the opaque one
 *    weighed on its own reflectance into the reflection target the resolve reads, the front one where the forward fragments read it. A
 *    transparent behind the front surface casts no ray: it reads the environment.
 *
 * Every mean is taken in the denoiser's space (`reflectionDenoised`), the same rule for every pixel:
 * no case of motion, resolution or surface chooses between two ways to one result.
 *
 * DISTANCE, by tiers (`../reach.ts`): the screen for every ray, its march ending at the image's edge or
 * `reflectionScreenSteps` iterations, its answer a hit or a miss (a hit near the image's border is taken by chance, `reflectionHitVignette`); the scene for the rest of a ray, marched through the global
 * distance field from where the screen stopped knowing it, the
 * light of the surface it meets read in the surface cache (`../sceneTrace.ts`); the screen's far trace where the ray left
 * the field, then the environment (the sky light's cube, `reflectionEnvironment`).
 *
 * COST. N pixels, R the rays (one a traced pixel traced this image, one a block, opaque and front), T
 * the tracing tiles, P the pixels of the resolve tiles, K the screen march's iterations at most, K̄ their
 * mean, p_miss the share of rays the screen misses, S̄ their mean steps of the march through
 * the field, S the steps a clipmap at most (`GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS`), C the clipmaps, H the cost of a hit's read;
 * r_m, r_s, r_h the iterations, steps and hit reads the GPU runs a second:
 * - classify: N flag reads at most, a normal and a lobe word a reflecting pixel, three atomics a listed tile a list;
 * - generate: 64·T threads, a flag read and, where the picked pixel traces, its normal, lobes and depth, a blue noise read, a ray of 12 bytes written;
 * - screen: 64·T threads, a depth read each; R · K̄ march iterations (one
 *   nearest read each, a farthest where the ray is not in front, a plane at the pixel), an 8-byte ray
 *   written for each ray, an 8-byte pending entry for each ray missed, one append a workgroup;
 * - scene: a thread a ray missed, R · p_miss of them, an 8-byte entry read each;
 *   R · p_miss · S̄ steps of the march (a coarse mip read of eight loads each, a page table read and, near a
 *   surface, a page read of eight loads), a hit one read of its object grid cell and, of up to four objects, their cards (a
 *   card: a few words of its records, four texels of three layers);
 * - resolve: P · (4 + the reconstruction's samples) rays and texels, a ray's data a tap; temporal:
 *   P · (8 history texels) and 144 resolved pixels a tile, staged once (`temporalStage`); bilateral: a
 *   pixel one history texel, and the filter's taps to twice as many, with their depths and
 *   normals, where its history counts under two images.
 * - t ≈ R · (K̄ / r_m + p_miss · (S̄ / r_s + H / r_h)) + P · (c_r + c_t + c_b), bounded by the view's pixels —
 *   at most R · (K / r_m + C · S / r_s + H / r_h) for the rays —, never by the scene nor its lights. Every image drawn
 *   pays it, still or moving.
 *
 * THE SCENE STAGE THROUGH THE SCENE'S TRIANGLES (`hardware`, with no counting): where the scene has acceleration structures
 * the scene stage is a program of its own, the kernel `traceScene` alone over the scene trace's version of the scene's answer
 * (`../sceneTraceHardware.ts`), which the field's version (`../sceneTrace.ts`) stands in for until it is compiled and where the scene has none.
 * The census counts the field's march alone: this program is made without the counting (`hardwareReflectionKernels`, its storage buffers being the eight a stage may hold).
 *
 * CENSUS (`../censusWgsl.ts`), where the project counts (`statistics`, `reflectionStatistics`, off by default: the kernels are then
 * compiled without it, and bind no buffer for it): the two ray stages tally their rays in the workgroup's own memory —
 * the screen stage where each ray ended (a hit or a miss), the scene stage how each march through the field ended and the
 * steps it took — and add them to one buffer of counters per workgroup, which the host reads back
 * a few images late (`../census.ts`).
 */
export const reflectionTraceShader = (statistics: boolean, hardware = false) =>
  wgslProgram(
    [
      traceDeclarations(statistics),
      ...(hardware ? [] : [generateRaysWgsl(), traceScreenWgsl(statistics)]),
      traceSceneWgsl(statistics, hardware),
    ].join('\n'),
    [
      // The lights' struct its group declares: what a lobe's weight and a ray's fog read of them.
      directLightWgsl(),
      ...(hardware ? [makeFinite3] : []),
      isFirstPerson,
      LOBES_LIGHTING_WGSL,
      LOBES_DECODE_WGSL,
      REFLECTION_LAYER_WGSL,
      reflectionLightViewWgsl(REFLECTION_GROUP),
      reflectionStagesWgsl(
        REFLECTION_GROUP,
        hardware ? REFLECTION_SCENE_TRACE_HARDWARE_WGSL : REFLECTION_SCENE_TRACE_WGSL,
        hardware,
      ),
      REFLECTION_LOBE_RAYS_WGSL,
      REFLECTION_SURFACES_WGSL,
      REFLECTION_TILES_WGSL,
      REFLECTION_TEXEL_WGSL,
      REFLECTION_SAMPLE_WGSL,
      blueNoiseWgsl(0, B.blue, true),
      REFLECTION_RESOLVE_WGSL,
      REFLECTION_TEMPORAL_WGSL,
      REFLECTION_BILATERAL_WGSL,
      REFLECTION_CLASSIFY_WGSL,
      ...(statistics ? [reflectionCensusWgsl(B.census)] : []),
      listWgsl({
        name: 'pendingOut',
        group: 0,
        binding: B.pendingOut,
        entry: 'vec2u',
        append: true,
      }),
      listWgsl({
        name: 'pendingIn',
        group: 0,
        binding: B.pendingIn,
        entry: 'vec2u',
        append: false,
      }),
    ],
  )
