import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import {
  SCENE_HIT_VELOCITY_WGSL,
  sceneHitVelocityEntry,
} from '../../rays/sceneTrace/sceneHitVelocityWgsl.ts'
import { sceneTraceAvoidWgsl } from '../../rays/sceneTrace/avoidWgsl.ts'
import { sceneTraceLayoutEntries } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceHitCardsLayoutEntries } from '../../surfaceCache/hitWgsl.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { tracedHitLightWgsl } from '../tracedHitWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spProbeRecords, spReach } from './probesWgsl.ts'
import { rayFogLayoutEntries, type RayFogBindings } from '../../reflections/rayFog.ts'
import { rayFogWgsl } from './rayFogWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { SP_FAR_PENDING, SP_RAY_CONE, spListedRays } from './traceSceneWgsl.ts'
import { spRays } from './traceWgsl.ts'

/**
 * THE SCENE STAGE'S RAYS CAST THROUGH THE SCENE'S TRIANGLES (`traceTriangles`): the stage that answers the rays the screen left when
 * the scene has acceleration structures, in place of the march through the global distance field (`traceSceneWgsl.ts`, which the
 * image keeps until this program is compiled and wherever the scene trace is not made). It is split from the radiance cache's answer
 * (`traceFar`, there) by WebGPU's limits of sixteen sampled textures and eight storage buffers a stage: the cut's four record tables and the
 * scene trace's three buffers leave no room for the cache's maps.
 *
 * A thread is a listed ray (`spListed`). The ray leaves the probe's surface along the normal by `screenProbeHardwareRayTracingNormalBias`
 * (turned toward the ray on a probe with backface diffuse light), from where the screen lost it — its end, `missed` — pulled
 * back by the pull-back bias (not nearer than the ray bias, `screenProbeHardwareRayTracingBias`, the hair's for a hair pixel) to the
 * probe's reach (`spLocalReach`, no nearer than the ray bias): a ray whose start is not before its end is not traced. It passes the translucent
 * primitives and avoids the geometry it starts on as `surfaceCacheHardwareRayTracingAvoidSelfIntersections` says (`SELF_INTERSECTION`):
 * the back faces of the primitives that are not two-sided culled; or traced again from past a first hit that is a back face nearer than
 * the trace's `skipBackFaceDistance` or a two-sided hit nearer than its `skipTwoSidedDistance`; or such hits passed as it travels.
 * A trace that stopped before its walk was whole and held no hit is a hit, black, at the ray's end; one that held a hit lights it as a whole trace does.
 * The light of a hit is the surface cache's, read at its point from the cards of the placement it met (`scHitPlacement` by the object the hit
 * names: the rank of its root, or the stand-in of its HLOD cell's actor, `scEvaluateMeshCards`: the coarse pages, no feedback), with the hit's normal and the footprint of the ray's cone
 * at the hit, over `sp.tracedHit.x` centimetres of depth bias; nothing from a hit nearer than `sp.tracedHit.y` centimetres, nor from the back
 * of a one-sided primitive. A hit writes its light, dithered by the probe tile's blue noise (`ditherLight`), and its distance (no
 * further than the furthest a ray looks), moving when the speed of the probe's surface and the speed of the placement the hit met
 * (`stHitVelocity`: its point less where the last image drew it) differ by more than the setting's share of the probe's depth (a metre at least); a ray that hit nothing writes the mark that leaves it to
 * the radiance cache (`SP_FAR_PENDING`) and keeps its light as the screen left it. Where the height fog is laid over the light of the probes' rays
 * (`screenProbeHeightFogOnGI`), a hit's light is fogged (`spRayFogged`, `rayFogWgsl.ts`) before it is written, from where the ray started (`spTracedStart`) over the distance it hit at.
 */
export const TRACE_TRACED_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [2, { store: F.info, access: 'read-only' }],
  normal: [3, 'uint'],
  pixels: [4, 'buffer-read'],
  ray: [5, { store: F.ray, access: 'read-only' }],
  radiance: [8, { store: F.trace }],
  hit: [14, { store: F.hit, access: 'read-write' }],
  bounceGrid: [11, 'uniform'],
  sceneRays: [12, 'buffer-read'],
  blue: [13, 'float'],
})
/** The cells' table the coverage names without reading: declared, in no layout. */
const TRACED_CELL_TABLE = 15
/** Where the stage reads what a hit finds: the surface cache's cards alone, the global field neither marched nor bound. The cut's tables it
 *  traces beside sit at the culling's bindings (1, 6, 7 and 9). */
export const TRACE_TRACED_HIT = { group: 0, cards: 16, instances: 25 } as const
/** The scene trace's group and its first binding in it. */
export const TRACE_TRACED_SCENE = { group: 2, first: 0 } as const

/** Where the stage reads the lights (the fog they hold), and the fog's cubemap and its sampler, where the height fog is laid over its rays. Clear of the
 *  layers of the cards, which their library declares beside the cards' bindings. */
export const TRACE_TRACED_FOG: RayFogBindings & { lights: number } = {
  cubemap: 26,
  sampler: 27,
  lights: 28,
}

/** The layout of the stage's group 0: its own bindings, the cut's tables and the poses the last image drew, the cards a hit reads, and, where `fog`, the lights and the fog's reads. */
export const traceTracedEntries = (fog: boolean, light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  ...TRACE_TRACED_BINDINGS.entries,
  ...dagReadLayoutEntries(),
  sceneHitVelocityEntry(),
  ...surfaceHitCardsLayoutEntries(TRACE_TRACED_HIT, light),
  ...(fog ? [computeBufferEntry(TRACE_TRACED_FOG.lights, 'read-only-storage')] : []),
  ...rayFogLayoutEntries(TRACE_TRACED_FOG, fog),
]
/** The layout of the stage's scene trace group. */
export const traceTracedSceneEntries = () => sceneTraceLayoutEntries(TRACE_TRACED_SCENE.first)

const T = TRACE_TRACED_BINDINGS.at

/** The text of the traced ray: its start off the surface and the ray itself. */
const SP_TRACED_RAY_TEXT = `struct SpTraced{radiance:vec3f,distance:f32,hit:bool,speed:f32,}
/** Where the ray \`d\` of \`probe\` starts: off the surface along its normal (turned toward the ray on a probe with backface diffuse light) by the normal bias. */
fn spTracedStart(probe:SpProbe,d:vec3f)->vec3f{
 var normal=probe.N;
 if(probe.foliage&&dot(normal,d)<0.0){normal=-normal;}
 return probe.P+sp.traced.y*normal;
}
/** The ray \`d\` of \`probe\` that the screen left at \`missed\` metres, to the \`reach\` of its cell, traced against the scene's triangles; \`speed\` the metres the placement it hit moved since the last image. */
fn spTracedRay(probe:SpProbe,d:vec3f,missed:f32,reach:f32,side:f32)->SpTraced{
 var rayBias=sp.traced.x;
 if(probe.hair){rayBias=max(rayBias,sp.traced.z);}
 var tMin=max(missed,rayBias);
 let tMax=max(reach,rayBias);
 var out=SpTraced(vec3f(0.0),tMax,false,0.0);
 if(!(tMin<tMax)){return out;}
 // The pull-back is applied only to a ray that did not reach its end, so that it is not traced again.
 tMin=max(tMin-sp.traced.w,rayBias);
 let origin=spTracedStart(probe,d);
 // Avoids the geometry the ray starts on as the setting says (stTraceAvoiding).
 let hit=stTraceAvoiding(origin-view.display.yzw,d,tMin,tMax,u32(sp.tracedHit.z));
 // A trace that stopped before its walk was whole and held no hit is a black hit at the ray's end; one that held a hit keeps its light.
 if(!hit.hit){
  out.hit=!stComplete;
  return out;
 }
 out.hit=true;
 out.distance=hit.distance;
 // No pose moved since the poses the last drawn frame drew were kept: the hit's placement stands where it stood, its speed exactly zero.
 if(spFlag(SP_FLAG_POSES_MOVING)){out.speed=length(stHitVelocity(hit.placement,origin-view.display.yzw+d*hit.distance,stParams.eyeXY,stEyeZ()));}
 // A hit too near to tell from the surface itself would light it with its own light; the back of a one-sided surface has no cards.
 out.radiance=tracedHitLight(hit,origin,d,side,sp.tracedHit.x,sp.tracedHit.y,vec2u(0u));
 return out;
}`

/** The radiance a ray cast through the scene's triangles finds (`spTracedRay`), and the distance it went. */
const spTracedRayWgsl = (light: LightAtlasFormat) =>
  wgslBlock(
    `SP_TRACED_RAY(${light})`,
    [
      sceneTraceAvoidWgsl(TRACE_TRACED_SCENE.group, TRACE_TRACED_SCENE.first),
      SCENE_HIT_VELOCITY_WGSL,
      tracedHitLightWgsl(TRACE_TRACED_HIT, TRACE_TRACED_SCENE, light),
    ],
    SP_TRACED_RAY_TEXT,
  )

/** The light of a hit (`spTracedLit`), `ray` of `probe` along `d`: the height fog laid over it, from where the ray started over the distance it hit at, where `fog`
 *  (`spRayFogged`, `rayFogWgsl.ts`), which reads the lights the stage then binds; the light of the hit as it is otherwise. */
const spTracedLit = (fog: boolean, light: LightAtlasFormat) =>
  wgslBlock(
    `spTracedLit(${fog},${light})`,
    fog
      ? [spTracedRayWgsl(light), DIRECT_LIGHT_WGSL, rayFogWgsl(TRACE_TRACED_FOG)]
      : [spTracedRayWgsl(light)],
    `${fog ? `@group(0) @binding(${TRACE_TRACED_FOG.lights}) var<storage,read> directLights:DirectLights;\n` : ''}fn spTracedLit(ray:SpTraced,probe:SpProbe,d:vec3f)->vec3f{
 return ${fog ? 'spRayFogged(ray.radiance,spTracedStart(probe,d),d,ray.distance,true)' : 'ray.radiance'};
}`,
  )

/** The stage, a thread a listed ray: its texel and where the screen left it read, a hit's light and the ray's end written. */
const traceTriangles = (fog: boolean, light: LightAtlasFormat) =>
  wgslBlock(
    `SP_TRACE_TRIANGLES(${fog},${light})`,
    [
      spListedRays(T.sceneRays),
      SP_RAY_CONE,
      spTracedRayWgsl(light),
      SP_FAR_PENDING,
      ditherLight,
      packLight,
      spTracedLit(fog, light),
    ],
    `@group(0) @binding(${T.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${T.hit}) var hitIo:texture_storage_2d<${F.hit},read_write>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn traceTriangles(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let listed=spListed(id,groups);
 if(!listed.ok){return;}
 let texel=vec2i(listed.at);
 let t=listed.at%SP_TRACE;
 let index=spIndexOf(listed.atlas);
 let own=probePixels[index];
 let probe=listed.probe;
 let reach=spLocalReach(probe.P);
 var ray=SpTraced(vec3f(0.0),reach,false,0.0);
 let direction=spRayDirection(listed.atlas,t,index);
 if(spFlag(SP_FLAG_SCENE_TRACES)){
  ray=spTracedRay(probe,direction,spHitDistance(textureLoad(hitIo,texel).r),reach,spRayCone(listed.atlas,t));
  if(ray.hit){ray.radiance+=spSkyLeak(direction,ray.distance);}
 }
 let end=min(ray.distance,spMaxTrace());
 if(!ray.hit){
  textureStore(hitIo,texel,vec4u(SP_FAR_PENDING,0u,0u,0u));
  return;
 }
 let lit=spTracedLit(ray,probe,direction);
 let moving=spHitMoving(probe,ray.speed);
 let noise=blueNoiseVec2(spProbeTile(index,own),sp.mode.w).y;
 textureStore(radianceOut,texel,vec4u(packLight(ditherLight(lit,noise)),0u,0u,0u));
 textureStore(hitIo,texel,vec4u(spHitWord(end,moving),0u,0u,0u));
}`,
  )

/** The stage's program over `side × side` rays a probe and `samples` of a tile, laying the height fog over the light of its hits where `fog`. */
export const traceTracedShader = (
  side: number,
  samples: readonly [number, number],
  fog: boolean,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) =>
  wgslProgram(
    `${spParams(T.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      bounceBindingsWgsl(0, T.bounceGrid, TRACED_CELL_TABLE),
      spCommon(samples),
      spReach,
      spProbeRecords(T.info, T.normal, true),
      spRays(T.ray, T.pixels, T.blue, true),
      traceTriangles(fog, light),
    ],
  )
