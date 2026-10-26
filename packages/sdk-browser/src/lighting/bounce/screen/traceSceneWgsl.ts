import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import {
  surfaceHitBindingsFrom,
  surfaceHitLayoutEntries,
  surfaceHitWgsl,
} from '../../surfaceCache/hitWgsl.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCacheRead } from './cacheReadWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spProbeRecords, spReach } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spRays } from './traceWgsl.ts'

/** The scene stage's bindings: the probes' records and pixels, the ray words, the radiance and ends written (the ends read and
 *  written in place), the cascades' uniform, the lights (the sky they hold), the list of the rays the screen left, the engine's blue
 *  noise, and the radiance cache's maps and their tags. */
export const TRACE_SCENE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, { store: F.info, access: 'read-only' }],
  normal: [2, 'float'],
  pixels: [4, 'buffer-read'],
  ray: [5, { store: F.ray, access: 'read-only' }],
  radiance: [6, { store: F.trace }],
  hit: [7, { store: F.hit, access: 'read-write' }],
  bounceGrid: [8, 'uniform'],
  lights: [10, 'buffer-read'],
  sceneRays: [12, 'buffer-read'],
  blue: [17, 'float'],
  cacheFinal: [18, 'uint'],
  cacheRaw: [19, 'uint'],
  cacheSky: [20, 'float'],
  cacheTags: [21, 'buffer-read'],
})
/** The atlas of the cascades' probes, which the radiance cache's lookup reads the probes' table in. */
export const TRACE_SCENE_PROBES = 9
/** Where the stage reads what its hits find: the global field its rays are marched through, its object grid and the surface cache
 *  (`../../surfaceCache/hitWgsl.ts`), from binding 22. */
export const TRACE_SCENE_HIT = surfaceHitBindingsFrom(0, 22)
/** The layout of the scene stage's group 0. */
export const traceSceneEntries = () => [
  ...TRACE_SCENE_BINDINGS.entries,
  atlasEntry(TRACE_SCENE_PROBES),
  ...surfaceHitLayoutEntries(TRACE_SCENE_HIT),
]

const C = TRACE_SCENE_BINDINGS.at

/** The list of the rays the screen left, as the scene stage is dispatched over it. */
const SCENE_RAYS_LIST = listWgsl({
  name: 'sceneRays',
  group: 0,
  binding: C.sceneRays,
  entry: 'u32',
  append: false,
})

/**
 * ONE RAY MARCHED THROUGH THE GLOBAL DISTANCE FIELD (`spMarchRay`), from `start` (metres) along a direction over `[begin, reach]`, its
 * light read where it meets a surface: the march is the field's (`gdfTrace`: its step the distance read, its surface expanded by the
 * ray's time, and, where `dithered`, a ray stopped on a sample no mesh covers by noise, drawn at the ray's texel `coord` and the image's turn). The
 * light of a hit is the surface cache's final lighting (`scGlobalHit`, `../../surfaceCache/hitWgsl.ts`), the footprint of the ray's
 * cone at the hit — the cone the equal-area octahedron gives a texel of `side` texels a side (`scConeTangent`) — its radius. Lengths are metres for the
 * probes, centimetres for the field and the cache. `spMarch` is a probe's ray: it leaves a point the bias (`sp.scene.x`) off the probe's
 * surface along its normal and again along itself, `begin` and `reach` are measured from there, and it is dithered.
 */
export const SP_MARCH = wgslBlock(
  'SP_MARCH',
  [surfaceHitWgsl(TRACE_SCENE_HIT)],
  `${wgslConsts({ SP_CM: DISTANCE_FIELD_UNITS_PER_METRE })}
struct SpMarch{lighting:vec3f,hit:bool,}
fn spMarchRay(start:vec3f,d:vec3f,begin:f32,reach:f32,side:f32,dithered:bool,coord:vec2u)->SpMarch{
 var out=SpMarch(vec3f(0.0),false);
 if(begin>=reach||gdfView.clipmaps==0u){return out;}
 let origin=start*f32(SP_CM);
 let marched=gdfTraceRay(origin,d,begin*f32(SP_CM),reach*f32(SP_CM),1.0,true,dithered,coord,f32(sp.size.w%8u));
 if(marched.hitTime<0.0){return out;}
 out.hit=true;
 out.lighting=scGlobalHit(origin,d,marched,scConeTangent(side),true,-1.0,false,vec2u(0u)).radiance;
 return out;
}
fn spMarch(probe:SpProbe,d:vec3f,begin:f32,reach:f32,coord:vec2u,side:f32)->SpMarch{
 return spMarchRay(probe.P+(probe.N+d)*sp.scene.x,d,begin,reach,side,true,coord);
}`,
)

/**
 * THE SCENE STAGE'S ANSWER TO A PROBE'S RAY the screen did not answer: the march through the global distance field from where the screen
 * lost the ray (two biases back; the screen's end, `missed`) to the reach of the probe's cell (`spLocalReach`: as far as the
 * radiance cache is asked to be traced before it is read, the scene's limit where it covers none) — the surface cache's light at a hit,
 * the end of the ray the reach —, then, for a ray the march left (the cache's eight probes gathered for it alone, none for a ray that hit), the light the radiance cache holds along it and its distance as the
 * end (`spFarOf`: the environment's light and the furthest a ray looks where the cache covers none). A hit is moving when the probe moves.
 */
const SP_SCENE_RAY = wgslBlock(
  'SP_SCENE_RAY',
  [SP_MARCH],
  `struct SpScene{radiance:vec3f,word:u32,}
fn spSceneRay(probe:SpProbe,d:vec3f,missed:f32,coord:vec2u,side:f32)->SpScene{
 let reach=spLocalReach(probe.P);
 let moving=abs(probe.speed)/max(probe.depth,1.0)>sp.motion.x;
 var march=SpMarch(vec3f(0.0),false);
 if(spFlag(SP_FLAG_SCENE_TRACES)){march=spMarch(probe,d,max(sp.motion.w,missed-2.0*sp.scene.x),reach,coord,side);}
 var radiance=march.lighting;
 var end=reach;
 if(!march.hit){
  if(spFlag(SP_FLAG_CACHE)){spCacheGatherOwn(probe.P);}
  let far=spFarOf(probe.P,d,side);
  radiance+=far.radiance;
  end=far.distance;
 }
 return SpScene(radiance,spHitWord(end,march.hit&&moving));
}`,
)

/** The scene stage, a thread a listed ray: its texel and where the screen left it read, its radiance and end written. */
const SP_TRACE_SCENE = wgslBlock(
  'SP_TRACE_SCENE',
  [SCENE_RAYS_LIST, SP_SCENE_RAY, packLight, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
  `@group(0) @binding(${C.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${C.hit}) var hitIo:texture_storage_2d<${F.hit},read_write>;
@group(0) @binding(${C.lights}) var<storage,read> directLights:DirectLights;
/** The texels a side of the grid the ray of trace texel \`t\` of the probe at \`atlas\` is a texel of (the grid \`spRayDirection\` reads it from): the
 *  width of its cone. */
fn spRayCone(atlas:vec2u,t:vec2u)->f32{
 if(!spFlag(SP_FLAG_IMPORTANCE)){return f32(SP_TRACE);}
 return f32(spRayMip(spRayLevel(spRayWordAt(vec2i(atlas*SP_TRACE+t))),SP_TRACE));
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn traceScene(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let rank=flatIndex(id,groups,WORKGROUP_THREADS);
 if(rank>=sceneRays.count){return;}
 let entry=sceneRays.entries[rank];
 let at=vec2u(entry&0xffffu,entry>>16u);
 let atlas=at/SP_TRACE;
 let probe=spReadProbe(atlas);
 if(probe.depth<=0.0){return;}
 let texel=vec2i(at);
 let t=at%SP_TRACE;
 let scene=spSceneRay(probe,spRayDirection(atlas,t,spIndexOf(atlas)),spHitDistance(textureLoad(hitIo,texel).r),spRayNoiseTexel(spIndexOf(atlas),t),spRayCone(atlas,t));
 textureStore(radianceOut,texel,vec4u(packLight(scene.radiance),0u,0u,0u));
 textureStore(hitIo,texel,vec4u(scene.word,0u,0u,0u));
}`,
)

/** The scene stage's program over `side × side` rays a probe and `samples` of a tile. */
export const traceSceneShader = (side: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(C.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      DIRECT_LIGHT_WGSL,
      bounceBindingsWgsl(0, C.bounceGrid, TRACE_SCENE_PROBES),
      spCommon(samples),
      spReach,
      spProbeRecords(C.info, C.normal, true),
      spCacheRead(C.cacheFinal, C.cacheRaw, C.cacheSky, C.cacheTags, 'private'),
      spRays(C.ray, C.pixels, C.blue, true),
      SP_TRACE_SCENE,
    ],
  )
