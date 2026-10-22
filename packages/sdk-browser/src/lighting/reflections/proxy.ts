import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { runtimeRadianceWgsl } from '../bounce/runtime/runtimeRadianceWgsl.ts'
import { REFLECTION_FATE_WGSL } from './censusWgsl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_PROXY_BINDINGS } from './trace/traceBindings.ts'
import { REFLECTION_LINEAR_DEPTH_WGSL } from './viewLayout.ts'

/**
 * The proxy's answer to a reflection (`reflectionProxied`), where the screen did not give one: the engine's
 * one coarse geometry of the scene (`../bounce/runtime/runtimeSceneWgsl.ts`), compiled meshes and the cuts the world
 * made at run time alike, the radiance of its surfaces read where the ray lands, by the light the probes hold
 * there and no more (`indirectHeld`), or the lit image where it agrees with the depth (`reflectionSeenAt`, `wgsl.ts`).
 * One ray a call, cast this image, kept nowhere, by the trace's scene stage alone (`trace/trace.ts`), for every
 * pixel that reflects, over its own group's proxy (`REFLECTION_PROXY_BINDINGS`). The ray leaves the surface along itself by
 * `surfaceBias` and off its normal by the proxy's certified error (its header's `error`), so that it never meets the
 * proxy's own copy of the surface it leaves; it begins where the screen stopped knowing it (`left`, its hit's slab
 * before it), and goes no further than `bound`, the surface the screen met on its way, nor than the scene's edge
 * (`reflectionSceneReach`, `reach.ts`).
 *
 * ONE WALK OF THE ENGINE'S ONE TRACER (`rtLayersOver`), its windows the ones of `reflectionRingsOf`. A DETAIL WINDOW
 * ahead, where the settings turn it on: from where the screen left the ray (less the surface bias) to
 * `reflectionView.reach.x` metres on a budget of its own, its result — a surface found, or where a walk that
 * spends the budget stopped — a hit by noise. Then the RINGS: the cascades' cubes about the eye, from the finest
 * that holds the ray's start by more than a voxel to the outermost, each ring the ray from where it enters its cube,
 * or where the ring before ended, to where it leaves it, cut at the reach, on a budget of its own
 * (`reflectionView.scene`). The nearest surface of a layer is that of the first window that holds one; a window that
 * spends its budget before it found one is skipped and the ray goes on at its end, one that found one keeps it; a surface
 * that lets light through passes its share on. A ray that meets nothing in any window goes on to the screen's far trace
 * and the environment (`wgsl.ts`).
 *
 * What a ray answers is its surfaces' radiance and confidence (the share of the ray they stop, `rtLayers`), the
 * distance of the first from `P`; zero where it hits nothing, or where the scene has no proxy. `open`: the share of
 * the ray that went through every surface it met, and every window it was not stopped in, to the scene's edge,
 * which leaves the scene; none for a ray cut by `bound`, or with no proxy to walk; what a hit stops without being
 * known (a deformed body's) is neither, and the field answers it. How the walk ended and the units it spent are
 * left in `reflectionFate` and `reflectionWork` (`censusWgsl.ts`), for the trace's census to count. The program
 * declares the lighting's view (`view`, for the eye's distance).
 */
export const REFLECTION_PROXY_WGSL = wgslBlock(
  'REFLECTION_PROXY_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_REACH_WGSL,
    REFLECTION_FATE_WGSL,
    REFLECTION_LINEAR_DEPTH_WGSL,
    WORLD_AT_WGSL,
    interleavedGradientNoise,
    runtimeRadianceWgsl(REFLECTION_PROXY_BINDINGS, 'reflectionSeenAt'),
  ],
  `struct ReflectionProxied{answer:RadianceAnswer,open:f32,}
/** How a walk that spent a budget ended, by what spent it (\`rtCause\`, \`RT_CAUSE_*\`). */
fn reflectionSpentFate(cause:u32)->u32{
 if(cause==RT_CAUSE_WORK){return REFLECTION_FATE_WORK;}
 if(cause==RT_CAUSE_TESTS){return REFLECTION_FATE_TESTS;}
 if(cause==RT_CAUSE_TREE){return REFLECTION_FATE_TREE;}
 return REFLECTION_FATE_MESH;
}
/** How the walk ended: a surface hit, else by what spent the first window that was, else out of the scene or nowhere. */
fn reflectionWalkFate(walk:RtWalk,open:f32)->u32{
 if(walk.answer.confidence>0.0){return REFLECTION_FATE_HIT;}
 if(walk.spent!=0u){return reflectionSpentFate(walk.spent);}
 return select(REFLECTION_FATE_MISS,REFLECTION_FATE_OPEN,open>0.0);
}
/** The windows of the ray from \`O\` (off the surface \`P\`) along \`R\`, \`reach\` far, the screen having left it \`left\` along it: the detail window
 *  of pixel \`coord\` where the settings turn it on, from \`left\` less the surface bias; then a ring for each cascade cube
 *  from the finest that holds the ray where the voxel stage resumes (four voxels of that cube before \`left\`), each from
 *  where it enters its cube to where it leaves it, cut at the reach. Without cubes, one ring over the whole ray. */
fn reflectionRingsOf(P:vec3f,O:vec3f,R:vec3f,left:f32,reach:f32,coord:vec2u)->RtRings{
 var rings=rtNoRings();
 rings.on=true;
 rings.work=reflectionView.scene.y;
 rings.tests=reflectionView.scene.z;
 let levels=reflectionLevels();
 if(levels==0u){
  rings.begins[0]=left;
  rings.ends[0]=reach;
  rings.count=1u;
 }else{
  let start=max(left-4.0*reflectionRingVoxel(reflectionRingFirst(O+R*left)),0.0);
  let first=reflectionRingFirst(O+R*start);
  for(var level=first;level<levels;level++){
   let span=reflectionRingSpan(level,O,R);
   rings.begins[level-first]=max(span.x,start);
   rings.ends[level-first]=min(span.y,reach);
  }
  rings.count=levels-first;
 }
 if(reflectionDone(REFLECTION_DETAIL_TRACES)){
  let fade=saturate(4.0*viewEyeDistance(P)/reflectionView.reach.y-3.0);
  let dither=interleavedGradientNoise(vec2f(coord)+vec2f(0.5),0.0);
  rings.detail=vec4f(reflectionView.reach.x,fade,dither,max(left-reflectionView.reach.z,0.0));
  rings.detailWork=reflectionView.detail.x;
  rings.detailTests=reflectionView.detail.y;
 }
 return rings;
}
/** The point a ray's radiance is read from, the surface it leaves (\`reflectionFogged\`, \`reflectionSeenAt\`). */
var<private> reflectionOrigin:vec3f;
fn reflectionProxied(P:vec3f,N:vec3f,lobe:ReflectionLobe,left:f32,bound:f32,coord:vec2u)->ReflectionProxied{
 let none=ReflectionProxied(RadianceAnswer(vec3f(0.0),0.0,0.0),0.0);
 reflectionFate=REFLECTION_FATE_NO_PROXY;
 reflectionWork=0u;
 if(rtProxy.instances==0u){return none;}
 let bias=reflectionView.reach.z;
 let edge=reflectionSceneReach();
 // Never past the surface the screen met, its slab and the proxy's error on either side of it.
 let far=min(edge,bound+2.0*rtProxy.error);
 let reach=far-bias;
 if(reach<=max(left-bias,0.0)){reflectionFate=REFLECTION_FATE_BOUND;return none;}
 // With the scene traces off no window is walked: the ray goes whole to what lies past the scene.
 var walk=RtWalk(RadianceAnswer(vec3f(0.0),0.0,reach),0.0,1.0,0u,0u);
 reflectionOrigin=P;
 if(reflectionDone(REFLECTION_SCENE_TRACES)){
  let O=P+lobe.R*bias+N*rtProxy.error;
  let rings=reflectionRingsOf(P,O,lobe.R,left,reach,coord);
  walk=rtLayersOver(O,lobe.R,reach,reflectionReadTangent(lobe),0u,0u,false,rings);
 }
 walk.answer.distance+=bias;
 let open=select(0.0,walk.open,far>=edge);
 reflectionWork=walk.work;
 reflectionFate=reflectionWalkFate(walk,open);
 return ReflectionProxied(walk.answer,open);
}`,
)
