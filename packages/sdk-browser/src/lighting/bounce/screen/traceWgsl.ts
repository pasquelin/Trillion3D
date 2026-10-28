import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import {
  clipToFramebuffer,
  ndcToPixel,
  pixelToNdc,
  slabPerspective,
} from '../../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { SURFACE_MODEL_MASK, UNLIT_FLAG } from '../../../materials/surface/surfaceModelWord.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { SCREEN_MARCH_WGSL } from '../../../visibility/hiz/gpu/screenMarch.ts'
import { SCREEN_MARCH_END_WGSL } from '../../../visibility/hiz/gpu/screenMarchBase.ts'
import type { MarchLanes } from '../../../visibility/hiz/gpu/screenMarchLanes.ts'
import { screenTraceDepthThresholdScale } from '../../distanceField/representationWgsl.ts'
import { castFunctionWgsl, SS_FURTHEST_WGSL } from '../../screenSpaceTracing/rayCastWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../../reflections/constantsWgsl.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../../reflections/viewLayout.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spHistoryDepth } from './historyWgsl.ts'
import { spProbes, spReach } from './probesWgsl.ts'
import {
  SCREEN_PROBE_FORMATS as F,
  PROBE_PIXEL_BINDINGS,
  bindingTable,
} from './screenProbeLayout.ts'
import { spVectors } from './vectorsWgsl.ts'
import { SP_THIN_FEATURE, SP_FIXED_TOLERANCE } from './traceFeatureWgsl.ts'

/** The screen trace's bindings: the probes' records and pixels, the ray words, the last image's pixels (their depths, the ones it
 *  was lit at) and the surfaces' vectors, the radiance and ends written, the list the rays the screen left are
 *  appended to; the cascades, whose level the probe stands in says how far the screen is trusted (`spLocalReach`). */
export const TRACE_SCREEN_BINDINGS = bindingTable({
  ...PROBE_PIXEL_BINDINGS,
  ray: [5, 'uint'],
  keptDepth: [6, 'float'],
  vectors: [7, 'uint'],
  radiance: [8, { store: F.trace }],
  hit: [9, { store: F.hit }],
  bounceGrid: [10, 'uniform'],
  sceneRays: [12, 'buffer'],
  flags: [13, 'uint'],
  blue: [14, 'float'],
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
  entry: 'u32',
  append: true,
})

/** The ray a trace texel stands for: its direction from the probe, by the octahedron texel the ray word names
 *  (or the texel itself, with no importance sampling) and the point of it the tile's blue noise picks. A kernel that
 *  reads it names the ray words at `words` — a sampled texture, or, where `stored`, a texture read as the storage it is written
 *  through: no sampled texture of the stage's sixteen spent on it —, the probes' pixels at `pixels` and the blue noise at `noise`;
 *  `spRayWordAt` reads a ray word. */
export const spRays = (words: number, pixels: number, noise: number, stored = false) =>
  wgslBlock(
    `spRays(${words}, ${pixels}, ${noise}, ${stored})`,
    [blueNoiseWgsl(0, noise)],
    `${
      stored
        ? `@group(0) @binding(${words}) var rayWords:texture_storage_2d<${F.ray},read>;
fn spRayWordAt(at:vec2i)->u32{return textureLoad(rayWords,at).r;}`
        : `@group(0) @binding(${words}) var rayWords:texture_2d<u32>;
fn spRayWordAt(at:vec2i)->u32{return textureLoad(rayWords,at,0).r;}`
    }
@group(0) @binding(${pixels}) var<storage,read> probePixels:array<u32>;
/** The texel the noise of the ray \`t\` of the probe \`index\` is drawn at: the probe's pixel, never its atlas row — the adaptive probes are
 *  numbered in the order the threads reached them, which differs from run to run —, so a view casts the same rays every run. */
fn spRayNoiseTexel(index:u32,t:vec2u)->vec2u{
 let pixel=probePixels[index];
 return vec2u(pixel&0xffffu,pixel>>16u)*SP_TRACE+t;
}
fn spRayDirection(atlas:vec2u,t:vec2u,index:u32)->vec3f{
 var coord=t;
 var size=f32(SP_TRACE);
 if(spFlag(SP_FLAG_IMPORTANCE)){
  let word=spRayWordAt(vec2i(atlas*SP_TRACE+t));
  coord=spRayCoord(word);
  size=f32(spRayMip(spRayLevel(word),SP_TRACE));
 }
 return equalAreaDecode((vec2f(coord)+blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w))/size);
}`,
  )

/**
 * WHERE A HIT WAS IN THE LAST IMAGE, and what it moved by: the device position its surface's vector names
 * (`spMotionOf`), its texel (held in the image, as a clamped point read is), the clip position it is expected at there (a moving hit's
 * depth moved with it, `spStoodClip`), whether the
 * hit is kept there (its vignette over the noise: a share of them dropped as the hit nears the edge, in this image and in the last).
 */
export const SP_HIT_HISTORY = wgslBlock(
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
 let stood=spStoodClip(motion,hitPoint,expected);
 if(stood.w<=0.0){return out;}
 let last=vec2i(reflectionView.radiance.xy)-vec2i(1);
 let texel=clamp(vec2i(floor(ndcToPixel(motion.ndc,reflectionView.radiance.xy))),vec2i(0),last);
 let vignette=min(spVignette(pixelToNdc(H.xy,view.viewport.xy)),spVignette(motion.ndc));
 return SpHistoryHit(texel,stood,motion.speed,vignette>=noise);
}`,
)

/**
 * THE FIXED-STEP CAST'S SHARED PARTS (`SP_FIXED_CAST`), for the passes that cast rays over the furthest depth from a point of the screen (the probes' fixed-step trace, the short-range
 * occlusion's stochastic hemisphere): `ssFurthest`, the furthest depth of the pyramid at a view texture coordinate and mip of the chain that starts at half the image's size — the finished
 * depth's where the pyramid is built with the planes, else the culling layer's, the same depth —, `spFixedWide`, the world length of `pixels` of the image's width at a point's depth, and
 * `spFixedRay`, the screen-space ray (`SsRay`) from a point along a direction over at most `reach` (and 95 % of its depth toward the eye), its step taken back to the border of the image,
 * its tolerance `spFixedTolerance` with `slope` (`InitScreenSpaceRayFromWorldSpace`).
 */
export const SP_FIXED_CAST = wgslBlock(
  'SP_FIXED_CAST',
  [
    castFunctionWgsl(false, true),
    SS_FURTHEST_WGSL,
    SP_FIXED_TOLERANCE,
    SCREEN_MARCH_END_WGSL,
    slabPerspective,
  ],
  `fn spFixedWide(P:vec3f,pixels:f32)->f32{
 let slab=reflectionView.slab;
 return pixels*slab.x*select(1.0,(reflectionView.viewProj*vec4f(P,1.0)).w,slabPerspective(slab));
}
fn spFixedRay(P:vec3f,d:vec3f,reach:f32,slope:f32)->SsRay{
 let slab=reflectionView.slab;
 let startClip=reflectionView.viewProj*vec4f(P,1.0);
 let toward=reflectionView.viewProj*vec4f(d,0.0);
 let ends=select(select(1e30,0.95*(slab.y-startClip.z)/toward.z,toward.z>0.0),select(1e30,-0.95*startClip.w/toward.w,toward.w<0.0),slabPerspective(slab));
 let span=min(reach,ends);
 let start=startClip.xyz/startClip.w;
 let endClip=reflectionView.viewProj*vec4f(P+d*span,1.0);
 var step=endClip.xyz/endClip.w-start;
 step*=screenMarchEnd(start.xy*vec2f(0.5,-0.5)+vec2f(0.5),step.xy*vec2f(0.5,-0.5),vec2f(1.0));
 return SsRay(start,step,spFixedTolerance(start.z,step.z,span,slope),true);
}`,
)

/** The screen's cast of a probe's ray (its begin and its march): the ray's span and where it crosses the framebuffer, and the march along it. */
const screenCastText = (lanes: MarchLanes) => `const SP_CLEAN_MISS_OFFSET:f32=0.02;
@group(0) @binding(${S.flags}) var sceneFlags:texture_2d<u32>;
/** What the screen answers: whether it did, whether what it met moves, the radiance of the last image at the hit, the distance. */
struct SpSeen{hit:bool,moving:bool,radiance:vec3f,distance:f32,}
/** A probe's ray before its march: whether the screen is traced along it at all (\`live\`), where it leaves the probe, its clip positions, the span it may go, the way it
 *  crosses the framebuffer (\`S0\`, \`delta\`, \`end\`) and the scale and thickness of the surface it is marched against. */
struct SpScreenCast{live:bool,origin:vec3f,A:vec4f,B:vec4f,span:f32,S0:vec3f,delta:vec3f,end:f32,scale:f32,thickness:f32,}
fn spScreenNone()->SpScreenCast{
 return SpScreenCast(false,vec3f(0.0),vec4f(0.0),vec4f(0.0),0.0,vec3f(0.0),vec3f(0.0),0.0,1.0,1.0);
}
/** The begin of the screen stage: the ray's cast (\`aimed\`), not live where the screen is not traced along it. */
fn spScreenBegin(probe:SpProbe,pixel:vec2u,reach:f32,d:vec3f)->SpScreenCast{
 var aimed=spScreenNone();
 // A pixel with backface diffuse light casts no ray toward its own backface, which would meet it at once; hair, where the setting keeps
 // it out of the screen trace, casts none.
 if((probe.foliage&&dot(probe.N,d)<0.0)||(probe.hair&&spFlag(SP_FLAG_SKIP_HAIR_HITS))){return aimed;}
 let flags=textureLoad(sceneFlags,vec2i(pixel),0).r;
 let z=hizOpaqueDepth(vec2i(pixel));
 let corner=worldAt(vec2f(pixel)+vec2f(1.0),z);
 var origin=probe.P+probe.N*(abs(dot(corner-probe.P,probe.N))*2.0);
 if(probe.hair){origin+=d*sp.screen.x;}
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 if(A.w<=0.0||any(abs(A.xy)>vec2f(A.w))){return aimed;}
 let size=view.viewport.xy;
 let toward=reflectionView.viewProj*vec4f(d,0.0);
 // A ray toward the eye ends where its depth is a hundredth of its origin's view depth, under either projection: a perspective's clip w is the
 // view depth; an orthographic one's is the gap of the device depth to the eye's plane (\`slab.y\`), which the ray's rise (\`toward.z\`) closes.
 let ends=select(select(1e30,0.99*(reflectionView.slab.y-A.z)/toward.z,toward.z>0.0),select(1e30,-0.99*A.w/toward.w,toward.w<0.0),slabPerspective(reflectionView.slab));
 let span=min(reach,ends);
 let S0=clipToFramebuffer(A,size);
 let B=A+toward*span;
 let delta=clipToFramebuffer(B,size)-S0;
 let end=screenMarchEnd(S0.xy,delta.xy,size);
 let scale=screenTraceDepthThresholdScale(flags,sp.trace.x);
 let thickness=select(REFLECTION_THICKNESS,sp.tuning.w/reflectionView.slab.x,slabPerspective(reflectionView.slab))*scale;
 aimed=SpScreenCast(true,origin,A,B,span,S0,delta,end,scale,thickness);
 return aimed;
}
/** The march of the screen along a aimed, \`live\` false for a thread with no ray to march, which still takes part in it where the march counts the lanes still walking (\`screenMarchLanes.ts\`). */
fn spScreenMarch(aimed:SpScreenCast${lanes === 'none' ? '' : ',occupancy:u32'})->ScreenHit{
 return screenMarch(aimed.S0,aimed.delta,select(0.0,aimed.end,aimed.live),aimed.thickness,sp.tuning.w*aimed.scale,reflectionView.slab,sp.counts.z,spFlag(SP_FLAG_FULL_RES_DEPTH)${lanes === 'none' ? '' : ',occupancy'});
}`

/** What the screen answers of the ray once marched: the last image's radiance at a hit, and the end of the stage. */
const screenAnswerText = `/** What the last image answers of a hit of the screen at \`H\` (framebuffer position and device depth), world point \`hitPoint\`, \`seen\` holding its distance: dropped near the border of
 *  this image or of the last, where the last image shows another surface there, or on a surface the settings keep the probes from; else the radiance of the last image. */
fn spScreenHit(probe:SpProbe,H:vec3f,hitPoint:vec3f,d:vec3f,noise:f32,seen0:SpSeen)->SpSeen{
 var seen=seen0;
 let previous=spHitHistory(H,hitPoint,noise);
 if(!previous.kept){return seen;}
 if(spDeviceGap(spKeptDepth(previous.texel),previous.expected)>=sp.tuning.z*mix(0.5,2.0,noise)){return seen;}
 if(spFlag(SP_FLAG_SKIP_FOLIAGE_HITS)||spFlag(SP_FLAG_SKIP_HAIR_HITS)||spFlag(SP_FLAG_SKIP_UNLIT_HITS)){
  let hitFlags=textureLoad(sceneFlags,vec2i(floor(H.xy)),0).r;
  if(spFlag(SP_FLAG_SKIP_FOLIAGE_HITS)&&((hitFlags&${SUBSURFACE_FLAG}u)!=0u||pixelModelOf(hitFlags)==${PIXEL_MODEL.subsurface}u)){return seen;}
  if(spFlag(SP_FLAG_SKIP_HAIR_HITS)&&pixelModelOf(hitFlags)==${PIXEL_MODEL.hair}u){return seen;}
  if(spFlag(SP_FLAG_SKIP_UNLIT_HITS)&&(hitFlags&${SURFACE_MODEL_MASK}u)==${UNLIT_FLAG}u){return seen;}
 }
 seen.hit=true;
 // The last image holds its light multiplied by the pre-exposure it was lit with: taken out; the sky light that leaks onto the hit joins it.
 seen.radiance=max(makeFinite3(textureLoad(reflectionImage,previous.texel,0).rgb),vec3f(0.0))*reflectionView.radiance.w+spSkyLeak(d,seen.distance);
 seen.moving=abs(probe.speed-previous.speed)/max(probe.depth,1.0)>sp.motion.x;
 return seen;
}
/** The end of the screen stage: what the screen answers of a live ray (\`aimed\`), \`marched\` its march. */
fn spScreenEnd(probe:SpProbe,aimed:SpScreenCast,marched:ScreenHit,d:vec3f,noise:f32)->SpSeen{
 var seen=SpSeen(false,false,vec3f(0.0),0.0);
 let origin=aimed.origin;
 let A=aimed.A;
 let B=aimed.B;
 let span=aimed.span;
 let S0=aimed.S0;
 let delta=aimed.delta;
 let end=aimed.end;
 let size=view.viewport.xy;
 if(marched.t<0.0||marched.plane.x<=0.0){
  // The point the march stopped at: a share of the screen's way turned into the share of the clip's.
  let stop=select(marched.t,marched.above,marched.t<0.0);
  let along=stop*A.w/(stop*A.w+(1.0-stop)*max(B.w,1e-6));
  seen.distance=min(distance(origin+d*(span*along),probe.P)+SP_CLEAN_MISS_OFFSET,spMaxTrace());
  return seen;
 }
 let H=S0+delta*marched.t;
 let hitPoint=worldAt(H.xy,H.z);
 seen.distance=min(distance(hitPoint,probe.P),spMaxTrace());
 if(sp.trace.y>0.0&&spThinFeature(S0,delta,end,marched.t,size,sp.trace.y)){return seen;}
 return spScreenHit(probe,H,hitPoint,d,noise,seen);
}`

/** The fixed-step trace, where the screen is not walked hierarchically. */
const screenFixedText = (hierarchical: boolean) =>
  `${
    hierarchical
      ? ''
      : `/** The screen's answer by a fixed number of steps over the furthest depth (\`ssCast\`, 16 steps from the pyramid's first level, a rough surface of 0.2, stopping at the first
 *  sample behind a surface), the ray cast from the probe's own point over at most a fifth of the screen's width at its depth, ending short of the eye plane (95 % of its depth),
 *  starting a step offset by the noise of its texel \`coord\`: a hit that is no uncertain one goes through the same checks as the hierarchical walk's (\`spScreenHit\`). */
fn spScreenTraceFixed(probe:SpProbe,pixel:vec2u,reach:f32,d:vec3f,noise:f32,coord:vec2u)->SpSeen{
 var seen=SpSeen(false,false,vec3f(0.0),0.0);
 let aimed=spScreenBegin(probe,pixel,reach,d);
 if(!aimed.live){return seen;}
 let size=view.viewport.xy;
 let ray=spFixedRay(probe.P,d,min(reach,spFixedWide(probe.P,0.2*size.x)),2.0*aimed.scale);
 let traced=ssCast(ray,0.2,16u,interleavedGradientNoise(vec2f(coord)+vec2f(0.5),0.0)-0.9,1.0);
 let hit=traced.found&&!traced.uncertain;
 let H=vec3f(traced.hit.xy*size,traced.hit.z);
 let hitPoint=worldAt(H.xy,H.z);
 // A ray that stopped behind a surface writes no distance: the word stays zero.
 if(traced.uncertain&&!hit){return seen;}
 seen.distance=min(distance(hitPoint,probe.P)+select(SP_CLEAN_MISS_OFFSET,0.0,hit),spMaxTrace());
 if(!hit){return seen;}
 return spScreenHit(probe,H,hitPoint,d,noise,seen);
}
`
  }`

/** The one-call entry of the screen stage, where the march has no lanes to count. */
const screenTraceEntryText = (lanes: MarchLanes, hierarchical: boolean) =>
  `${
    lanes === 'none' && hierarchical
      ? `fn spScreenTrace(probe:SpProbe,pixel:vec2u,reach:f32,d:vec3f,noise:f32)->SpSeen{
 let aimed=spScreenBegin(probe,pixel,reach,d);
 if(!aimed.live){return SpSeen(false,false,vec3f(0.0),0.0);}
 return spScreenEnd(probe,aimed,spScreenMarch(aimed),d,noise);
}`
      : ''
  }`

/**
 * THE SCREEN'S ANSWER TO A PROBE'S RAY: the previous lit image, at the point the ray meets in the depth. The ray leaves the
 * probe's surface twice a pixel's corner off its normal (the depth is point-sampled: a pixel's depth sticks out of the plane it
 * stands for), goes no further than the cascades trust the screen — `reach`, `spLocalReach`: past it the field of the world's
 * probes answers: twice the diagonal of the cell of the finest level that holds the probe, the scene's limit where none does
 * — and marches the depth pyramid (`screenMarch`, a surface `sp.tuning.w` of its depth thick, times `screenProbeThicknessScaleWithoutField` where the probe's surface has no distance field (`screenTraceDepthThresholdScale`) — the setting `screenProbeRelativeDepthThickness` times the projection's scale —, `sp.counts.z` iterations, down to the full-resolution depth by the setting `hizFullResDepth`). A
 * start off the screen, a hit near its edge, a hit the last image lit another surface at (its device depth then, in the history's depths,
 * against the one expected within `sp.tuning.z`, widened or narrowed by the noise), or on a thin
 * sheet that transmits light (`SUBSURFACE_FLAG`, the surface buffer's mark of backface diffuse light, or the subsurface shading model, by the setting `screenProbeSkipFoliageHits`), on hair (`screenProbeSkipHairHits`) or on an unlit surface (`screenProbeSkipUnlitHits`), or one with a thin feature in front of it (`spThinFeature`, `screenProbeThicknessCertaintySteps` samples, taken only where foliage hits are kept), is a miss, the next
 * stage's. A ray the screen answers keeps the radiance the last image lit its hit with, and is moving when what it met moves
 * against the probe (`sp.motion.x`: their speeds' difference over the probe's depth, a metre at least); every ray keeps its
 * distance: to the hit, even a dropped one, or, a miss, to where the march stopped (the last place it proved the ray clear, `above`)
 * and two centimetres past it: the scene trace starts there. A pixel with backface diffuse light casts no ray toward its own backface; a hair pixel's ray starts
 * `screenProbeScreenTracesHairBias` along itself, and casts none where hair hits are skipped.
 */
const spScreenTraceBlock = (lanes: MarchLanes, hierarchical: boolean) =>
  wgslBlock(
    `SP_SCREEN_TRACE(${lanes}, ${hierarchical})`,
    [
      SP_HIT_HISTORY,
      SP_THIN_FEATURE,
      interleavedGradientNoise,
      clipToFramebuffer,
      slabPerspective,
      screenTraceDepthThresholdScale,
      pixelModelOf,
      makeFinite3,
      ...(hierarchical ? [] : [SP_FIXED_CAST]),
    ],
    [
      screenCastText(lanes),
      screenAnswerText,
      screenFixedText(hierarchical),
      screenTraceEntryText(lanes, hierarchical),
    ].join('\n'),
  )

/** How the rays the screen left are put in the list for the scene stage: by the subgroup's prefix (`native`, the `subgroups` feature), or, the same ranks, by a scan the workgroup's threads make in its memory (`polyfill`). */
export type SceneCompaction = 'native' | 'polyfill'

/**
 * THE RANK OF A THREAD AMONG THE THREADS OF ITS WORKGROUP THAT WANT A PLACE IN THE LIST (`spCompact`), in the order of the threads — the
 * ordered compaction of the reference's wave-operations path (`ScreenProbeCompactTracesCS`, `WavePrefixCountBits`): the ranks of a subgroup are the prefix count of
 * its lanes that want one, and the subgroups take theirs from the group's count in turn (`native`); the scan, for a device with no subgroups, ranks the
 * threads of the whole group in the order of their lanes (`polyfill`: a Hillis-Steele scan, `SP_TRACE` squared threads, every thread in uniform control flow).
 * `spCompactTotal` is the group's count once every thread has ranked. A kernel that names it declares `SP_TRACE`.
 */
const spCompact = (compaction: SceneCompaction) =>
  wgslBlock(
    `SP_COMPACT(${compaction})`,
    [],
    compaction === 'native'
      ? `enable subgroups;
diagnostic(off,subgroup_uniformity);
var<workgroup> compactCount:atomic<u32>;
fn spCompactBegin(){atomicStore(&compactCount,0u);}
fn spCompactRank(wants:bool,lane:u32)->u32{
 let flag=select(0u,1u,wants);
 let inSubgroup=subgroupExclusiveAdd(flag);
 let subgroupSum=subgroupAdd(flag);
 var first=0u;
 if(subgroupElect()){first=atomicAdd(&compactCount,subgroupSum);}
 return subgroupBroadcastFirst(first)+inSubgroup;
}
fn spCompactTotal()->u32{return atomicLoad(&compactCount);}`
      : `var<workgroup> compactScan:array<u32,SP_TRACE*SP_TRACE>;
fn spCompactBegin(){}
fn spCompactRank(wants:bool,lane:u32)->u32{
 let flag=select(0u,1u,wants);
 compactScan[lane]=flag;
 workgroupBarrier();
 for(var step=1u;step<SP_TRACE*SP_TRACE;step=step<<1u){
  var before=0u;
  if(lane>=step){before=compactScan[lane-step];}
  workgroupBarrier();
  compactScan[lane]+=before;
  workgroupBarrier();
 }
 return compactScan[lane]-flag;
}
fn spCompactTotal()->u32{return compactScan[SP_TRACE*SP_TRACE-1u];}`,
  )

/**
 * THE SCREEN STAGE, a group a probe, a thread each of its rays. It writes every ray's radiance (`packLight`, dithered by the ray's noise) and end, and
 * lists, for the scene stage, every ray the screen did not answer — those that left the screen, whose hit was dropped or that
 * reached the end of the screen's range: the radiance cache answers what the near scene leaves of them —: the threads that want a place rank themselves in
 * the order of their lanes (`spCompact`), the group takes its place in the list once (`sceneRaysAppend`, the dispatch raised with it), each entry the ray's texel (the distance the
 * screen left it at is its end's, which the scene stage reads). A probe that stands on no lit surface lists none (the reference's `ShouldTraceScreenProbeTexel`).
 */
const spTraceScreenEntry = (
  lanes: MarchLanes,
  hierarchical: boolean,
  compaction: SceneCompaction,
) =>
  wgslBlock(
    `SP_TRACE_SCREEN_ENTRY(${lanes}, ${hierarchical}, ${compaction})`,
    [SCENE_RAYS_LIST, packLight, ditherLight, spCompact(compaction)],
    `@group(0) @binding(${S.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${S.hit}) var hitOut:texture_storage_2d<${F.hit},write>;
var<workgroup> probeReach:f32;
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
  spCompactBegin();
  probeReach=select(spMaxTrace(),spLocalReach(probe.P),live);
 }
 ${lanes === 'polyfill' ? 'screenMarchLane=lane;\n ' : ''}workgroupBarrier();
 var seen=SpSeen(false,false,vec3f(0.0),0.0);
 // The noise of a ray is drawn at its texel of the traces' atlas.
 let noise=interleavedGradientNoise(vec2f(at)+vec2f(0.5),f32(sp.frames.x%SP_TILE_JITTERS));
${
  lanes === 'none'
    ? ` if(live&&spFlag(SP_FLAG_SCREEN_TRACES)){
  let own=probePixels[index];
  let pixel=vec2u(own&0xffffu,own>>16u);
  seen=${hierarchical ? 'spScreenTrace(probe,pixel,probeReach,spRayDirection(atlas,t,index),noise)' : 'spScreenTraceFixed(probe,pixel,probeReach,spRayDirection(atlas,t,index),noise,at)'};
 }
`
    : ` // The march counts the lanes still walking: every thread of the group takes part in it, in uniform control flow, those with no ray with none to march.
 var aimed=spScreenNone();
 let direction=spRayDirection(atlas,t,index);
 if(live&&spFlag(SP_FLAG_SCREEN_TRACES)){
  let own=probePixels[index];
  aimed=spScreenBegin(probe,vec2u(own&0xffffu,own>>16u),probeReach,direction);
 }
 let marched=spScreenMarch(aimed,sp.frames.w);
 if(aimed.live){seen=spScreenEnd(probe,aimed,marched,direction,noise);}
`
} let wants=live&&!seen.hit;
 let slot=spCompactRank(wants,lane);
 workgroupBarrier();
 if(lane==0u){sceneBase=sceneRaysAppend(spCompactTotal(),${WORKGROUP_THREADS}u);}
 workgroupBarrier();
 if(wants){sceneRays.entries[sceneBase+slot]=at.x|(at.y<<16u);}
 textureStore(radianceOut,vec2i(at),vec4u(packLight(ditherLight(seen.radiance,noise)),0u,0u,0u));
 textureStore(hitOut,vec2i(at),vec4u(select(0u,spHitWord(seen.distance,seen.moving),live&&spFlag(SP_FLAG_SCREEN_TRACES)),0u,0u,0u));
}`,
  )

/** The screen trace's program over `side × side` rays a probe and `samples` of a tile. */
export const traceScreenShader = (
  side: number,
  samples: readonly [number, number],
  lanes: MarchLanes = 'none',
  hierarchical = true,
  compaction: SceneCompaction = 'polyfill',
) =>
  wgslProgram(
    `${spParams(S.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      REFLECTION_CONSTANTS_WGSL,
      SCREEN_MARCH_WGSL(
        REFLECTION_GROUP,
        REFLECTION_DEPTH_BINDING,
        lanes,
        lanes === 'polyfill' ? side * side : undefined,
      ),
      bounceBindingsWgsl(0, S.bounceGrid, TRACE_SCREEN_PROBES),
      spCommon(samples),
      spReach,
      spProbes(S.info, S.normal, S.counts),
      spRays(S.ray, S.pixels, S.blue),
      spVectors(S.vectors),
      spHistoryDepth(S.keptDepth),
      spScreenTraceBlock(lanes, hierarchical),
      spTraceScreenEntry(lanes, hierarchical, compaction),
    ],
  )
