import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import {
  clipToFramebuffer,
  ndcToPixel,
  pixelToNdc,
  slabPerspective,
} from '../../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { SCREEN_MARCH_WGSL } from '../../../visibility/hiz/gpu/screenMarch.ts'
import { screenTraceDepthThresholdScale } from '../../distanceField/representationWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../../reflections/constantsWgsl.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../../reflections/viewLayout.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spHistory } from './historyWgsl.ts'
import { spProbes, spReach } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The screen trace's bindings: the probes' records and pixels, the ray words, the last image's history (the depths it
 *  was lit at) and the surfaces' vectors, the radiance and ends written, the list the rays the screen left are
 *  appended to; the cascades, whose level the probe stands in says how far the screen is trusted (`spLocalReach`). */
export const TRACE_SCREEN_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'float'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  ray: [5, 'uint'],
  history: [6, 'uint'],
  vectors: [7, 'uint'],
  radiance: [8, { store: F.trace }],
  hit: [9, { store: F.hit }],
  bounceGrid: [10, 'uniform'],
  sceneRays: [12, 'buffer'],
  flags: [13, 'uint'],
})
/** The atlas of the cascades' probes of the screen trace. */
export const TRACE_SCREEN_PROBES = 11
export const traceScreenEntries = () => [
  ...TRACE_SCREEN_BINDINGS.entries,
  atlasEntry(TRACE_SCREEN_PROBES),
]

const S = TRACE_SCREEN_BINDINGS.at

/** The list of the rays the screen left to the scene, as the screen stage appends to it. */
const SCENE_RAYS_LIST = listWgsl({
  name: 'sceneRays',
  group: 0,
  binding: S.sceneRays,
  entry: 'vec2u',
  append: true,
})

/** The ray a trace texel stands for: its direction from the probe, by the octahedron texel the ray word names
 *  (or the texel itself, with no importance sampling) and the point of it the tile's noise picks. A kernel that
 *  reads it names the ray words at `words` and the probes' pixels at `pixels`. */
export const spRays = (words: number, pixels: number) =>
  wgslBlock(
    `spRays(${words}, ${pixels})`,
    [],
    `@group(0) @binding(${words}) var rayWords:texture_2d<u32>;
@group(0) @binding(${pixels}) var<storage,read> probePixels:array<u32>;
fn spRayDirection(atlas:vec2u,t:vec2u,index:u32)->vec3f{
 var coord=t;
 var size=f32(SP_TRACE);
 if(spFlag(SP_FLAG_IMPORTANCE)){
  let word=textureLoad(rayWords,vec2i(atlas*SP_TRACE+t),0).r;
  coord=spRayCoord(word);
  size=f32(spRayMip(spRayLevel(word),SP_TRACE));
 }
 return equalAreaDecode((vec2f(coord)+spNoise(spProbeTile(probePixels[index]),sp.mode.w))/size);
}`,
  )

/**
 * WHERE A HIT WAS IN THE LAST IMAGE, and what it moved by: the device position its surface's vector names
 * (`spMotionOf`), its texel, the clip position it is expected at there, whether the hit is kept there (inside the image, its
 * vignette over the noise: a share of them dropped as the hit nears the edge, in this image and in the last).
 */
const SP_HIT_HISTORY = wgslBlock(
  'SP_HIT_HISTORY',
  [ndcToPixel, pixelToNdc],
  `/** The hit's weight against the screen's edge: one inside, falling to nothing at it. */
fn spVignette(ndc:vec2f)->f32{
 let v=saturate(abs(ndc)*5.0-vec2f(4.0));
 return saturate(1.0-dot(v,v));
}
struct SpHistoryHit{texel:vec2i,expected:vec4f,speed:f32,kept:bool,}
fn spHitHistory(H:vec3f,hitPoint:vec3f,noise:f32)->SpHistoryHit{
 var out=SpHistoryHit(vec2i(0),vec4f(0.0),0.0,false);
 let expected=reflectionView.radianceViewProj*vec4f(hitPoint,1.0);
 if(expected.w<=0.0){return out;}
 let motion=spMotionOf(vec2i(floor(H.xy)),hitPoint,expected.xy/expected.w);
 let texel=vec2i(floor(ndcToPixel(motion.ndc,reflectionView.radiance.xy)));
 let vignette=min(spVignette(pixelToNdc(H.xy,view.viewport.xy)),spVignette(motion.ndc));
 let inside=all(texel>=vec2i(0))&&all(vec2f(texel)<reflectionView.radiance.xy);
 return SpHistoryHit(texel,expected,motion.speed,inside&&vignette>=noise);
}`,
)

/**
 * THE SCREEN'S ANSWER TO A PROBE'S RAY: the previous lit image, at the point the ray meets in the depth. The ray leaves the
 * probe's surface twice a pixel's corner off its normal (the depth is point-sampled: a pixel's depth sticks out of the plane it
 * stands for), goes no further than the cascades trust the screen — `reach`, `spLocalReach`: past it the field of the world's
 * probes answers: twice the diagonal of the cell of the finest level that holds the probe, the scene's limit where none does
 * — and marches the depth pyramid (`screenMarch`, a surface `sp.tuning.w` of its depth thick, times `screenProbeThicknessScaleWithoutField` where the probe's surface has no distance field (`screenTraceDepthThresholdScale`) — the setting `screenProbeRelativeDepthThickness` times the projection's scale —, `sp.counts.z` iterations, down to the full-resolution depth by the setting `hizFullResDepth`). A
 * start off the screen, a hit near its edge, a hit the last image lit another surface at (its depth then, in the history's meta
 * word, against the one expected within `sp.tuning.z` of device depth, widened or narrowed by the noise), or on a thin
 * sheet that transmits light (`SUBSURFACE_FLAG`, the surface buffer's mark of backface diffuse light, by the setting `screenProbeSkipFoliageHits`), or one with a thin feature in front of it (`spThinFeature`, `screenProbeThicknessCertaintySteps` samples, taken only where foliage hits are kept), is a miss, the next
 * stage's. A ray the screen answers keeps the radiance the last image lit its hit with, and is moving when what it met moves
 * against the probe (`sp.motion.x`: their speeds' difference over the probe's depth, a metre at least); every ray keeps its
 * distance: to the hit, even a dropped one, to where the march left the screen, or, a clean miss, two centimetres past its
 * reach: the scene trace starts there.
 */
const SP_SCREEN_TRACE = wgslBlock(
  'SP_SCREEN_TRACE',
  [
    SP_HIT_HISTORY,
    interleavedGradientNoise,
    clipToFramebuffer,
    slabPerspective,
    screenTraceDepthThresholdScale,
  ],
  `const SP_CLEAN_MISS_OFFSET:f32=0.02;
@group(0) @binding(${S.flags}) var sceneFlags:texture_2d<u32>;
/** Whether a thin feature stands in front of the hit: \`steps\` linear samples along the ray from the hit toward its end,
 *  over a span of \`steps\` texels of the half-resolution level, the first at the hit; the ray is above the closest depth
 *  there at any of them. */
fn spThinFeature(start:vec3f,delta:vec3f,end:f32,t:f32,size:vec2f,steps:f32)->bool{
 let ray=start+delta*t;
 let remain=delta*(end-t);
 let span=length(delta.xy*end/size*(1.0/size)*steps);
 let endTime=min(span/max(length(remain.xy/size),1e-12),1.0);
 for(var i=0.0;i<steps;i+=1.0){
  let p=ray+(i/steps)*endTime*remain;
  if(all(p.xy>vec2f(0.0))&&all(p.xy<size)){
   let tileZ=select(screenTileDepth(p.xy,0,hizLevelCount()-1),hizOpaqueDepth(vec2i(floor(p.xy))),hizTracePlanes());
   if(p.z>tileZ){return true;}
  }
 }
 return false;
}
/** What the screen answers: whether it did, whether what it met moves, the radiance of the last image at the hit, the distance. */
struct SpSeen{hit:bool,moving:bool,radiance:vec3f,distance:f32,}
fn spScreenTrace(probe:SpProbe,pixel:vec2u,reach:f32,d:vec3f,noise:f32)->SpSeen{
 var seen=SpSeen(false,false,vec3f(0.0),0.0);
 let z=hizOpaqueDepth(vec2i(pixel));
 let corner=worldAt(vec2f(pixel)+vec2f(1.0),z);
 let origin=probe.P+probe.N*(abs(dot(corner-probe.P,probe.N))*2.0);
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 if(A.w<=0.0||any(abs(A.xy)>vec2f(A.w))){return seen;}
 let size=view.viewport.xy;
 let toward=reflectionView.viewProj*vec4f(d,0.0);
 let grow=toward.z-toward.w;
 let span=min(reach,select(1e30,(A.w-A.z)/grow,grow>0.0));
 let S0=clipToFramebuffer(A,size);
 let B=A+toward*span;
 let delta=clipToFramebuffer(B,size)-S0;
 let end=screenMarchEnd(S0.xy,delta.xy,size);
 let scale=screenTraceDepthThresholdScale(textureLoad(sceneFlags,vec2i(pixel),0).r,sp.trace.x);
 let thickness=select(REFLECTION_THICKNESS,sp.tuning.w/reflectionView.slab.x,slabPerspective(reflectionView.slab))*scale;
 let marched=screenMarch(S0,delta,end,thickness,sp.tuning.w*scale,reflectionView.slab,sp.counts.z,spFlag(SP_FLAG_FULL_RES_DEPTH));
 if(marched.t<0.0||marched.plane.x<=0.0){
  let left=end*A.w/(end*A.w+(1.0-end)*max(B.w,1e-6));
  seen.distance=select(left*span,min(reach+SP_CLEAN_MISS_OFFSET,SP_MAX_TRACE),end>=1.0);
  return seen;
 }
 let H=S0+delta*marched.t;
 let hitPoint=worldAt(H.xy,marched.plane.x+dot(H.xy-marched.pixel,marched.plane.yz));
 seen.distance=min(distance(hitPoint,probe.P),SP_MAX_TRACE);
 if(sp.trace.y>0.0&&spThinFeature(S0,delta,end,marched.t,size,sp.trace.y)){return seen;}
 let previous=spHitHistory(H,hitPoint,noise);
 if(!previous.kept){return seen;}
 if(spDeviceGap(textureLoad(historyIn,previous.texel,0).g,previous.expected)>=sp.tuning.z*mix(0.5,2.0,noise)){return seen;}
 if(spFlag(SP_FLAG_SKIP_FOLIAGE_HITS)&&(textureLoad(sceneFlags,vec2i(floor(H.xy)),0).r&${SUBSURFACE_FLAG}u)!=0u){return seen;}
 seen.hit=true;
 // The last image holds its light multiplied by the pre-exposure it was lit with: read as it is.
 seen.radiance=textureLoad(reflectionImage,previous.texel,0).rgb*reflectionView.radiance.w;
 seen.moving=abs(probe.speed-previous.speed)/max(probe.depth,1.0)>sp.motion.x;
 return seen;
}`,
)

/**
 * THE SCREEN STAGE, a group a probe, a thread each of its rays. It writes every ray's radiance (`packLight`) and end, and
 * lists, for the scene stage, the rays the screen neither answered nor cleanly missed — those that left the screen or whose
 * hit was dropped — and that the probe's cell leaves to the scene (the end of the ray's distance under the probe's reach): a
 * workgroup counts its own and takes its place in the list once (`sceneRaysAppend`, the dispatch raised with it), each
 * entry the ray's texel and the distance the screen left it at.
 */
const SP_TRACE_SCREEN_ENTRY = wgslBlock(
  'SP_TRACE_SCREEN_ENTRY',
  [SCENE_RAYS_LIST, packLight],
  `@group(0) @binding(${S.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${S.hit}) var hitOut:texture_storage_2d<${F.hit},write>;
var<workgroup> probeReach:f32;
var<workgroup> sceneCount:atomic<u32>;
var<workgroup> sceneBase:u32;
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn traceScreen(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let index=spIndexOf(atlas);
 let probe=spProbeOrDead(atlas);
 let live=probe.depth>0.0;
 let t=vec2u(lane%SP_TRACE,lane/SP_TRACE);
 let at=atlas*SP_TRACE+t;
 if(lane==0u){
  atomicStore(&sceneCount,0u);
  probeReach=select(SP_MAX_TRACE,spLocalReach(probe.P,probe.N),live);
 }
 workgroupBarrier();
 var seen=SpSeen(false,false,vec3f(0.0),0.0);
 if(live&&spFlag(SP_FLAG_SCREEN_TRACES)){
  let own=probePixels[index];
  let pixel=vec2u(own&0xffffu,own>>16u);
  let noise=interleavedGradientNoise(vec2f(at)+vec2f(0.5),f32(sp.size.w%SP_TILE_JITTERS));
  seen=spScreenTrace(probe,pixel,probeReach,spRayDirection(atlas,t,index),noise);
 }
 let wants=live&&spFlag(SP_FLAG_SCENE_TRACES)&&!seen.hit&&seen.distance<probeReach;
 var slot=0u;
 if(wants){slot=atomicAdd(&sceneCount,1u);}
 workgroupBarrier();
 if(lane==0u){sceneBase=sceneRaysAppend(atomicLoad(&sceneCount),${WORKGROUP_THREADS}u);}
 workgroupBarrier();
 if(wants){sceneRays.entries[sceneBase+slot]=vec2u(at.x|(at.y<<16u),bitcast<u32>(seen.distance));}
 textureStore(radianceOut,vec2i(at),vec4u(packLight(seen.radiance),0u,0u,0u));
 textureStore(hitOut,vec2i(at),vec4u(select(0u,spHitWord(seen.distance,seen.hit,seen.moving),live&&spFlag(SP_FLAG_SCREEN_TRACES)),0u,0u,0u));
}`,
)

/** The screen trace's program over `side × side` rays a probe and `samples` of a tile. */
export const traceScreenShader = (side: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(S.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      REFLECTION_CONSTANTS_WGSL,
      SCREEN_MARCH_WGSL(REFLECTION_GROUP, REFLECTION_DEPTH_BINDING),
      bounceBindingsWgsl(0, S.bounceGrid, TRACE_SCREEN_PROBES),
      spCommon(samples),
      spReach,
      spProbes(S.info, S.normal, S.counts),
      spRays(S.ray, S.pixels),
      spHistory(S.history, S.vectors),
      SP_SCREEN_TRACE,
      SP_TRACE_SCREEN_ENTRY,
    ],
  )
