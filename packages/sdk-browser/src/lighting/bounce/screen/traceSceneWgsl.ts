import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { runtimeRadianceWgsl } from '../runtime/runtimeRadianceWgsl.ts'
import { sceneLayoutEntries, type SceneBindings } from '../sceneBindings.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spProbes, spReach } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spRays } from './traceWgsl.ts'

/** The scene trace's bindings: the probes' records and pixels, the ray words, the radiance and ends the stages before wrote,
 *  read and written in place, the cascades, the lights, the light grid's lists, the list of the rays the screen left, and
 *  the proxy the rays walk. */
export const TRACE_SCENE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'float'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  ray: [5, 'uint'],
  radiance: [6, { store: F.trace, access: 'read-write' }],
  hit: [7, { store: F.hit, access: 'read-write' }],
  bounceGrid: [8, 'uniform'],
  lights: [10, 'buffer-read'],
  lightLists: [11, 'buffer-read'],
  sceneRays: [12, 'buffer-read'],
  blue: [16, 'float'],
})
/** The atlas of the cascades' probes of the scene trace, and the proxy's three bindings. */
export const TRACE_SCENE_PROBES = 9
export const SCREEN_PROXY_BINDINGS: SceneBindings = { group: 0, proxy: 13, worlds: 14, tree: 15 }
export const traceSceneEntries = () => [
  ...TRACE_SCENE_BINDINGS.entries,
  atlasEntry(TRACE_SCENE_PROBES),
  ...sceneLayoutEntries(SCREEN_PROXY_BINDINGS),
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
 * ONE WALK OF THE PROXY from the probe along a direction over `[begin, end]`, lit: the engine's one coarse geometry of the
 * scene (`../runtime/runtimeSceneWgsl.ts`, the proxy the world's probes and the reflections cast their rays over), its first
 * surface lit where the ray lands — the lights, their shadows traced against the proxy, the bounce — as a world probe's ray
 * lights it (`rtLayers`, lit). The ray leaves a point the larger of the bias (`sp.scene.z`) and the proxy's certified error off the
 * surface and along the direction, so that it never meets the proxy's own copy of the surface it leaves, and `begin` and `end` are
 * measured from that point; the light the first surface sends back, the share of the walk left unanswered (`transparency`), and the distance it reached.
 */
const SP_WALK = wgslBlock(
  'SP_WALK',
  [],
  `struct SpWalk{lighting:vec3f,transparency:f32,distance:f32,}
fn spWalk(probe:SpProbe,d:vec3f,begin:f32,end:f32)->SpWalk{
 if(rtProxy.instances==0u||begin>=end){return SpWalk(vec3f(0.0),1.0,0.0);}
 let lift=max(sp.scene.z,rtProxy.error);
 let walk=rtLayers(probe.P+(probe.N+d)*lift+d*begin,d,end-begin,0.0,RT_PROBE_WORK,RT_PROBE_TRIANGLES,true);
 return SpWalk(walk.answer.color*walk.stopped,1.0-walk.stopped,begin+walk.answer.distance);
}`,
)

/**
 * THE DETAIL TRACE, for the probes within `sp.scene.y` of the eye where it is on (`SP_FLAG_MESH_TRACES`): a short walk, up to
 * `sp.scene.x`, from where the screen lost the ray (two biases back), whose hit is taken by noise against the share the
 * surfaces stop and the share fading out with the probe's distance from the eye (`6 · distance / sp.scene.y − 5`, saturated):
 * a hit brings back its light, the faded share less. A ray it does not hit goes on to the coarse trace.
 */
const SP_DETAIL = wgslBlock(
  'SP_DETAIL',
  [SP_WALK, interleavedGradientNoise],
  `struct SpDetail{ran:bool,hit:bool,lighting:vec3f,distance:f32,}
fn spDetailEnd()->f32{return min(sp.scene.x,spMaxTrace());}
fn spDetail(probe:SpProbe,d:vec3f,missed:f32,coord:vec2u)->SpDetail{
 var out=SpDetail(false,false,vec3f(0.0),0.0);
 let begin=max(sp.motion.w,missed-2.0*sp.scene.z);
 if(begin>=spDetailEnd()){return out;}
 out.ran=true;
 let walk=spWalk(probe,d,begin,spDetailEnd());
 let fade=saturate(6.0*viewEyeDistance(probe.P)/sp.scene.y-5.0);
 if(mix(walk.transparency,1.0,fade)<interleavedGradientNoise(vec2f(coord)+vec2f(0.5),0.0)){
  out.hit=true;
  out.lighting=walk.lighting*(1.0-fade);
  out.distance=min(walk.distance,spMaxTrace());
 }
 return out;
}`,
)

/**
 * THE SCENE'S ANSWER TO A PROBE'S RAY, in the order the stages come: the detail trace where it applies, then, for a ray it did
 * not hit — or that it did not run for —, the coarse trace from where the stage before ended (two biases back) to the reach of the
 * probe's cell (`spLocalReach`), a hit where more than half of it is stopped, its end the reach (a grazing ray's real distance
 * is noise to the filter). The ray's radiance so far is the far field's (`field`): the coarse trace brings the walk's light
 * and leaves the share it does not stop to the field, the detail trace's hit replaces it. A hit is moving when the probe moves.
 */
const SP_SCENE_RAY = wgslBlock(
  'SP_SCENE_RAY',
  [SP_DETAIL],
  `struct SpScene{radiance:vec3f,word:u32,}
fn spSceneRay(probe:SpProbe,d:vec3f,missed:f32,coord:vec2u,field:vec3f,fieldWord:u32)->SpScene{
 let reach=spLocalReach(probe.P);
 let moving=abs(probe.speed)/max(probe.depth,1.0)>sp.motion.x;
 var begin=max(sp.motion.w,missed-2.0*sp.scene.z);
 if(spFlag(SP_FLAG_MESH_TRACES)&&probe.depth<sp.scene.y){
  let detail=spDetail(probe,d,missed,coord);
  if(detail.hit){return SpScene(detail.lighting,spHitWord(detail.distance,true,moving));}
  if(detail.ran){begin=max(sp.motion.w,spDetailEnd()-2.0*sp.scene.z);}
 }
 let walk=spWalk(probe,d,begin,reach);
 var out=SpScene(walk.lighting+walk.transparency*field,fieldWord);
 if(walk.transparency<=0.5){out.word=spHitWord(reach,true,moving);}
 return out;
}`,
)

/** The scene stage, a thread a listed ray: its texel and where the screen left it read, its radiance and end updated in place. */
const SP_TRACE_SCENE = wgslBlock(
  'SP_TRACE_SCENE',
  [SCENE_RAYS_LIST, SP_SCENE_RAY, packLight, unpackLight, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
  `@group(0) @binding(${C.radiance}) var radianceIo:texture_storage_2d<${F.trace},read_write>;
@group(0) @binding(${C.hit}) var hitIo:texture_storage_2d<${F.hit},read_write>;
@group(0) @binding(${C.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${C.lightLists}) var<storage,read> tileLights:array<u32>;
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
 let d=spRayDirection(atlas,at%SP_TRACE,spIndexOf(atlas));
 let ended=textureLoad(hitIo,texel).r;
 let scene=spSceneRay(probe,d,spHitDistance(ended),at,unpackLight(textureLoad(radianceIo,texel).r),ended);
 textureStore(radianceIo,texel,vec4u(packLight(scene.radiance),0u,0u,0u));
 textureStore(hitIo,texel,vec4u(scene.word,0u,0u,0u));
}`,
)

/** The scene trace's program over `side × side` rays a probe and `samples` of a tile. */
export const traceSceneShader = (side: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(C.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      DIRECT_LIGHT_WGSL,
      bounceBindingsWgsl(0, C.bounceGrid, TRACE_SCENE_PROBES),
      runtimeRadianceWgsl(SCREEN_PROXY_BINDINGS),
      spCommon(samples),
      spReach,
      spProbes(C.info, C.normal, C.counts),
      spRays(C.ray, C.pixels, C.blue),
      SP_TRACE_SCENE,
    ],
  )
