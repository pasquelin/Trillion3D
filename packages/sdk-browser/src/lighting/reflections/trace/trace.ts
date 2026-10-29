import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { directLightWgsl } from '../../direct/lightWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../../direct/lobesWgsl.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { bitMask, bitWord, lowBits, makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
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
import { REFLECTION_STORED_RAY_WGSL } from '../storedRayWgsl.ts'
import { reflectionCensusWgsl } from '../censusWgsl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../viewLayout.ts'
import { REFLECTION_LOBE_RAYS_WGSL } from '../weight.ts'
import { REFLECTION_CLASSIFY_WGSL } from '../tiles.ts'
import { reflectionStagesWgsl } from '../wgsl.ts'
import { reflectionSceneTraceWgsl } from '../sceneTrace.ts'
import { reflectionSceneTraceHardwareWgsl } from '../sceneTraceHardware.ts'
import type { SceneCompaction } from '../../bounce/screen/traceWgsl.ts'
import { REFLECTION_MESH_ANSWERED, reflectionMeshesWgsl } from './meshesWgsl.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { isFirstPerson } from '../../../materials/surface/surfaceModel.ts'
import type { MarchLanes } from '../../../visibility/hiz/gpu/screenMarchLanes.ts'

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
/** The lanes of the screen stage's workgroup that missed, a bit each along the Z-order curve of the group's texels. */
var<workgroup> missedBits:array<atomic<u32>,${(REFLECTION_SIDE * REFLECTION_SIDE) / 32}>;
var<workgroup> pendingBase:u32;
/** The two numbers a texel's ray is drawn from: the blue noise at the grid texel \`g\` and the image's turn. */
fn reflectionSampleAt(g:vec2u)->vec2f{return blueNoiseVec2(g,reflectionView.temporal.x);}
/** The ray the pixel \`own\` casts, drawn from \`u\`: the lobe it traces sampled (\`reflectionTopRay\`, through its top layer's
 *  roughness, about the normal of that top layer), a mirror's — a roughness under a thousandth — its reflection about it, no draw. */
fn reflectionCastRay(own:ReflectingPixel,u:vec2f)->ReflectionLobeRay{
 var ray=reflectionTopRay(own.topN,own.V,own.top,u);
 if(own.top<0.001){ray.R=reflect(-own.V,own.topN);}
 return ray;
}
/** The cone angle of the ray \`ray\` the pixel \`own\` casts: the inverse of the pdf of the ray it was drawn as
 *  (\`reflectionRayCone\`), the smallest angle for a mirror, whose ray is drawn from no distribution. */
fn reflectionCastCone(own:ReflectingPixel,ray:ReflectionLobeRay)->f32{
 if(own.top<0.001){return REFLECTION_MIN_CONE;}
 return reflectionRayCone(own.topN,own.V,ray.axis.xyz,vec2f(ray.along,ray.alpha),ray.R);
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
  // The ray goes as far as the view's longest ray until the radiance cache shortens it (cacheLimits).
  textureStore(surfaceRays,texel,REFLECTION_RAY_DISTANCE,vec4u(0u));
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

/** The screen stage's begin: what a thread keeps of its texel and the cast of its march. */
const SCREEN_BEGIN_WGSL = `/** A ray the screen stage missed: its pending entry — its texel and the distance its miss reached — and whether there is one. */
struct ReflectionMissed{entry:vec2u,missed:bool,}
/** What a thread keeps of the screen stage of its grid texel between the stage's begin and its end: whether the texel casts a ray, the pixel that casts it, the
 *  ray the ray generation stored for it and the cast of its screen march (\`reflectionScreenBegin\`). */
struct ReflectionScreenTexel{valid:bool,own:ReflectingPixel,stored:ReflectionStoredRay,aimed:ReflectionScreenCast,}
fn reflectionScreenTexelNone()->ReflectionScreenTexel{
 return ReflectionScreenTexel(false,ReflectingPixel(),ReflectionStoredRay(),reflectionScreenNone());
}
/** The begin of the screen stage of grid texel \`g\` of the surface \`layer\`, cast from the pixel of its block the ray generation picked
 *  (\`reflectionPickedPixel\`) along the ray it stored (\`reflectionStoredRay\`). A texel whose picked pixel casts no ray (its depth negative) is not \`valid\`: it writes
 *  nothing, no kernel reads a texel that traces none. */
fn traceScreenBegin(g:vec2u,layer:u32)->ReflectionScreenTexel{
 let texel=vec2i(g);
 var begun=reflectionScreenTexelNone();
 // The depth its writer reads as storage, the one binding of it this kernel has.
 if(!reflectionRayTraces(bitcast<f32>(textureLoad(surfaceRays,texel,REFLECTION_RAY_DEPTH).r))){return begun;}
 let coord=vec2i(reflectionPickedPixel(g));
 begun.valid=true;
 begun.own=reflectingPixelAt(layer,coord,surfaceFlagsAt(coord));
 begun.stored=reflectionStoredRay(texel);
 begun.aimed=reflectionScreenBegin(begun.own.P,begun.own.topN,begun.stored.ray);
 return begun;
}`

/** The screen stage's end: the fresh texel written where the screen hit, the ray returned as pending where it missed. */
const screenEndWgsl = (
  statistics: boolean,
) => `/** The end of the screen stage of grid texel \`g\`, \`marched\` the march of its cast: its fresh texel written where the screen hit; otherwise the
 *  ray missed, returned as its pending entry. */
fn traceScreenEnd(begun:ReflectionScreenTexel,marched:ScreenHit,g:vec2u)->ReflectionMissed{
 let b=reflectionScreenEnd(begun.own.P,begun.own.topN,begun.stored.ray,begun.aimed,marched,g);
 ${statistics ? 'countScreen(b.hit);' : ''}
 if(b.hit){
  textureStore(traceOut,vec2i(g),freshPack(b.radiance,b.distance));
  return ReflectionMissed(vec2u(0u),false);
 }
 return ReflectionMissed(vec2u(g.x|(g.y<<16u),bitcast<u32>(b.distance)),true);
}`

/** The screen stage's kernel `traceScreen`, which lists the rays its group missed. */
const screenKernelWgsl = (
  statistics: boolean,
  lanes: MarchLanes,
) => `/** The place of the texel \`c\` of a tracing tile along the Z-order curve: the bits of its column and row interleaved, the column's lowest. */
fn reflectionZOrder(c:vec2u)->u32{
 var z=0u;
 for(var b=0u;b<${Math.log2(REFLECTION_SIDE)}u;b++){z|=(((c.x>>b)&1u)<<(2u*b))|(((c.y>>b)&1u)<<(2u*b+1u));}
 return z;
}
/** One thread a grid texel of a tracing tile (\`tiles.ts\`); the rays its group missed listed at once, one
 *  atomic a group on the list, the scene stage's dispatch raised to hold them. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn traceScreen(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 var begun=reflectionScreenTexelNone();
 if(all(id<reflectionGridSize())){begun=traceScreenBegin(id,REFLECTION_LAYER);}
${lanes === 'polyfill' ? ' screenMarchLane=lane;\n' : ''} // The march of the screen, every thread of the group taking part in it, in uniform control flow, those with no ray with none to march.
 let marched=reflectionSeenMarch(begun.aimed.ray,begun.aimed.live);
 var missed=ReflectionMissed(vec2u(0u),false);
 if(begun.valid){missed=traceScreenEnd(begun,marched,id);}
 // The rays the group missed take their places in the list along the Z-order of their texels, so that neighbours in the list are neighbours on the screen.
 let z=reflectionZOrder(local.xy);
 if(missed.missed){atomicOr(&missedBits[bitWord(z)],bitMask(z));}
 // The barrier also orders the group's bits (the tally's flush holds it).
 ${statistics ? 'flushTally(lane);' : 'workgroupBarrier();'}
 var slot=countOneBits(atomicLoad(&missedBits[bitWord(z)])&lowBits(z&31u));
 for(var w=0u;w<bitWord(z);w++){slot+=countOneBits(atomicLoad(&missedBits[w]));}
 if(lane==0u){
  var n=0u;
  for(var w=0u;w<${(REFLECTION_SIDE * REFLECTION_SIDE) / 32}u;w++){n+=countOneBits(atomicLoad(&missedBits[w]));}
  if(n>0u){pendingBase=pendingOutAppend(n,${REFLECTION_SIDE * REFLECTION_SIDE}u);}
 }
 workgroupBarrier();
 if(missed.missed){pendingOut.entries[pendingBase+slot]=missed.entry;}
}`

/** The screen stage: the kernel `traceScreen` and the texel it casts. */
const traceScreenWgsl = (statistics: boolean, lanes: MarchLanes) =>
  [SCREEN_BEGIN_WGSL, screenEndWgsl(statistics), screenKernelWgsl(statistics, lanes)].join('\n')

/** The scene stage: the kernel `traceScene` and the ray it marches. */
const traceSceneWgsl = (
  statistics: boolean,
  hardware: boolean,
) => `/** The ray the screen stage missed, missed: the ray the ray generation stored for its texel, from the pixel's point and the normal of its top layer (the coat's where it
 *  carries one, which the normal bias of the ray through the scene's triangles follows), marched through the scene from where the
 *  screen stopped knowing it, and its texel's fresh radiance written whole. Its cone angle, which dithers the march's step, is the
 *  inverse of its pdf. A pixel of a first-person object (the stored cone's sign) casts a ray that does not meet the stand-ins of
 *  first-person objects (ST_MEET_WORLD_SPACE). A ray the meshes' fields stage answered whole (REFLECTION_MESH_ANSWERED) is left. */
fn traceSceneRay(missed:vec2u){
 ${hardware ? '' : `if(missed.y==${REFLECTION_MESH_ANSWERED}){return;}`}
 let g=vec2u(missed.x&0xffffu,missed.x>>16u);
 let texel=vec2i(g);
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));
 // The ray the ray generation stored, read as the storage the screen stage reads it through.
 let stored=reflectionStoredRay(texel);
 let b=reflectionSceneStage(own.P,own.topN,stored.ray,bitcast<f32>(missed.y),g,stored.cone,stored.firstPerson);
 textureStore(traceOut,texel,freshPack(${hardware ? 'makeFinite3(b.radiance)' : 'b.radiance'},b.distance));
 // A ray that reads the radiance cache and met nothing within its distance is left to cacheReads: its distance kept as it was with its lowest bit set.
 if(reflectionCached&&!b.hit){textureStore(surfaceRays,texel,REFLECTION_RAY_DISTANCE,vec4u(bitcast<u32>(-reflectionFar())|1u,0u,0u,0u));}
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
 *    (`ReflectionView.march.w`), unless the project reads the radiance cache for the rough reflections (`reflectionRadianceCache`): the kernel `cacheLimits` then
 *    shortens the rays of the pixels the cache covers (`radianceCache/wgsl.ts`) before the screen stage, and `cacheReads` gives the ones that met nothing the cache's light after the scene stage.
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
 * 1″. MESHES (`meshes.ts`, `meshesWgsl.ts`), where the project traces the meshes' fields (`meshDistanceFieldTrace`, `reflectionMeshDistanceFieldTrace`; the opaque surface alone): before the scene stage, the rays the screen
 *    missed near the camera are listed (`compactReflectionMeshes`) and marched through the meshes of their cell of the view's grid (`traceReflectionMeshes`); a hit the fade lets through is the ray's whole answer
 *    (the scene stage then leaves it), a ray that is not answered goes on to the scene stage from where this one left it.
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
 * MINIMUM OCCUPANCY (`lanes`, `../../../visibility/hiz/gpu/screenMarchLanes.ts`): the screen stage's march gives a ray up when no more than
 * `reflectionView.taps.z` lanes of its subgroup are still walking, counted by the subgroup's vote where the device has subgroups, else by a count in the
 * workgroup's memory over virtual subgroups of 32 threads.
 *
 * THE SURFACE CACHE'S FINAL LIGHT, which a hit reads, is stored in the format the cache's atlases are (`light`, `lightAtlasFormat`): the program, the layouts
 * and the final view the stage is bound with are all for the one.
 *
 * CENSUS (`../censusWgsl.ts`), where the project counts (`statistics`, `reflectionStatistics`, off by default: the kernels are then
 * compiled without it, and bind no buffer for it): the two ray stages tally their rays in the workgroup's own memory —
 * the screen stage where each ray ended (a hit or a miss), the scene stage how each march through the field ended and the
 * steps it took — and add them to one buffer of counters per workgroup, which the host reads back
 * a few images late (`../census.ts`).
 */
export const reflectionTraceShader = (
  statistics: boolean,
  hardware = false,
  lanes: MarchLanes = 'none',
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
  meshes?: SceneCompaction,
) =>
  wgslProgram(
    [
      traceDeclarations(statistics),
      ...(hardware ? [] : [generateRaysWgsl(), traceScreenWgsl(statistics, lanes)]),
      traceSceneWgsl(statistics, hardware),
    ].join('\n'),
    [
      ...(meshes ? reflectionMeshesWgsl(meshes) : []),
      // The lights' struct its group declares: what a lobe's weight and a ray's fog read of them.
      directLightWgsl(),
      ...(hardware ? [makeFinite3] : []),
      isFirstPerson,
      bitWord,
      bitMask,
      lowBits,
      LOBES_LIGHTING_WGSL,
      LOBES_DECODE_WGSL,
      REFLECTION_LAYER_WGSL,
      reflectionLightViewWgsl(REFLECTION_GROUP),
      reflectionStagesWgsl(
        REFLECTION_GROUP,
        hardware ? reflectionSceneTraceHardwareWgsl(light) : reflectionSceneTraceWgsl(light),
        hardware,
        lanes,
      ),
      REFLECTION_LOBE_RAYS_WGSL,
      REFLECTION_SURFACES_WGSL,
      REFLECTION_STORED_RAY_WGSL,
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
