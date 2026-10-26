/**
 * THE TRACE OF ONE LIGHT AT ONE RECEIVER, through its virtual shadow maps: the rays across the
 * light's disk — a sun's angular disk, a local light's emitter as the receiver sees it, one cone —
 * each started on the receiver's plane within its dither square, marched over the light's map from
 * its far end to its start (`traceRayWgsl.ts`), their share of misses the shadow factor. One ray,
 * one march, one bias and one ray-count rule for every light: the light's map (`traceMapWgsl.ts`)
 * says where a ray reads, and how far it reaches — a sun's ray a share of the receiver's distance to
 * the eye, a local one most of the way to its light.
 *
 * A 32-pixel half of a compute projection group votes (`vsmVoteAllTrue`) to stop its rays early
 * (`rayCountStatement`); a fragment's trace (`lone`): a sun's traces every ray, a local light's
 * votes over its subgroup, or on the lane's own value without subgroups. A ray is marched from its
 * far end to its start (`vsmMarch`), over the pool's stored depths read directly. Reads the view
 * `vsmView` the host declares, the pages of `pool` (`vsmPoolLoad`) and the blue noise `noise` declares
 * (`blueNoiseVec2`).
 * World unit = metre; a literal in centimetres is converted with `VSM_UNIT_PER_CM`.
 */
import { wgslF32 } from '../../../../../../math/src/wgsl/number.ts'
import { VSM_PROJECTION_LIGHT_STRUCT } from '../projection/projectionView.ts'
import { VSM_CONSTANTS_WGSL, VSM_UNIT_PER_CM } from '../constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import {
  VSM_TRACE_COMMON_WGSL,
  VSM_TRACE_RESULT_WGSL,
  rayCountStatement,
  vsmLoneVoteWgsl,
  vsmRayNoiseWgsl,
} from './traceCommonWgsl.ts'
import { vsmTraceMapWgsl } from './traceMapWgsl.ts'
import { vsmTraceRayWgsl } from './traceRayWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { transformPoint } from '../../../../../../math/src/wgsl/projection.ts'
import { vsmScreenSegmentWgsl } from './traceScreenWgsl.ts'
import {
  Frame3,
  frameAround,
  intoFrame,
  outOfFrame,
} from '../../../../../../math/src/wgsl/basis.ts'

/** The values of `VSM_TRACE_KINDS`: the suns alone, the local lights alone, both. */
export const VSM_TRACE_KINDS_SUN = 1
export const VSM_TRACE_KINDS_LOCAL = 2
export const VSM_TRACE_KINDS_BOTH = 3

/** A light of the projection, as its view uniform holds it (`../projection/projectionView.ts`): the traces' and
 *  the region test's (`vsmLightParticipates`). `radius` and `cosCone` are the lighting's range and
 *  cone (`localLightReaches`), `direction` points towards the light. */
export const vsmTraceLightWgsl = (kinds = VSM_TRACE_KINDS_BOTH) =>
  wgslBlock(
    `VSM_TRACE_LIGHT_WGSL(${kinds})`,
    [VSM_CONSTANTS_WGSL],
    `${VSM_PROJECTION_LIGHT_STRUCT}
/** The kinds of light a pipeline traces (\`VSM_TRACE_KINDS_*\`): the suns alone, the local lights
 *  alone, or both — a projection pipeline's specialisation, a lit program's default (its key's
 *  \`sunless\`, \`localless\`, \`vsmTraceKindsOf\`). A pipeline of one kind folds the other kind's
 *  map, ray lines and reach away: its registers are that kind's alone. The same light either way. */
override VSM_TRACE_KINDS:u32=${kinds}u;
fn vsmLightIsDirectional(light:VsmProjectionLight)->bool{
 return VSM_TRACE_KINDS==${VSM_TRACE_KINDS_SUN}u||(VSM_TRACE_KINDS==${VSM_TRACE_KINDS_BOTH}u&&light.kind==LIGHT_KIND_DIRECTIONAL);
}`,
  )

/** The kinds a lit program's key traces: what it leaves out (\`sunless\`, \`localless\`) is folded
 *  away. */
export const vsmTraceKindsOf = ({
  sunless,
  localless,
}: {
  sunless?: boolean
  localless?: boolean
}) => (sunless ? VSM_TRACE_KINDS_LOCAL : localless ? VSM_TRACE_KINDS_SUN : VSM_TRACE_KINDS_BOTH)

/** What a host gives the trace (`vsmReceiverTraceWgsl`). */
export interface VsmTraceHost {
  /** The pool's `vsmPoolLoad` the rays sample. */
  pool: WgslDecl
  /** The blue noise the rays' random pair is read from (`blueNoiseWgsl`). */
  noise: WgslDecl
  /** The depth pyramid's group and first binding (`hizDepthEntries`) the screen segment marches. */
  hiz: readonly [group: number, binding: number]
  /** A fragment's trace, which votes beside no lane of a projection group. */
  lone: boolean
  /** A fragment's device grants subgroups: its local lights vote over its subgroup
   *  (`vsmLoneVoteWgsl`). */
  subgroups?: boolean
  /** The kinds of light it traces by default (`vsmTraceLightWgsl`), both unless given. */
  kinds?: number
}

const traceLightSetupText = /* wgsl */ `fn vsmTraceLight(light:VsmProjectionLight,pixel:VsmPixel,receiver:VsmReceiver,participating:bool)->VsmTraceResult{
 let P=receiver.P;
 let n=pixel.info.worldNormal;
 let directional=vsmLightIsDirectional(light);
 let toLight=light.shiftedPosition-P;
 let dist=length(toLight);
 let axis=select(toLight/dist,light.direction,directional);
 var result=vsmEmptyTrace();
 var traced=participating;
 var lightMap:VsmLightMap;
 if(traced){lightMap=vsmLightMapAt(light,P);traced=lightMap.valid;}
 var basis:Frame3;
 var s=0.0;
 // The view's rays and steps for this kind of light (\`VsmProjectionView.traceRays\`): a light with no
 // rays (0) takes one tap along its axis, with no spread of the ray, no dither and no steps.
 let rays=select(vsmView.traceRays.y,vsmView.traceRays.x,directional);
 let single=rays==0u;
 var stepCount=i32(select(vsmView.traceRays.w,vsmView.traceRays.z,directional));
 var frameDepthSlope=vec2f(0.0);
 var ditherWorld=0.0;
 var ditherUv=0.0;
 var uvDepthSlope=vec2f(0.0);
 var biasCap=0.0;
 var lightReach=0.0;
 var startOffset=pixel.screenRayWorld;
 if(traced){
  if(!pixel.info.subsurface&&pixel.screenRayWorld>0.0){
   startOffset=vsmScreenRayFrom(receiver.screen,P,axis,pixel.screenRayWorld,pixel.noise);
  }
  let pd=vsmProjectionOf(lightMap.handle);
  let pInMap=lightMap.pInMap;
  let viewPosition=transformPoint(vsmView.shiftedToView,P);
  // A sun's ray reaches a share of the receiver's distance to the eye, a local one its light.
  lightReach=select(dist,vsm.traceReachSun*length(viewPosition),directional);
  // The light's disk as the receiver sees it: a sun's sine of its angular radius, a local light's
  // emitter over its distance. A point source's rays all meet the map in one texel: one sample.
  s=select(min(light.sourceRadius/dist,1.0),light.sourceRadius,directional);
  if(single){s=0.0;}
  // A sun's disk grows as its subsurface receiver's opacity falls, to emulate the light's diffusion
  // in the material (\`vsm.subsurfaceMinSourceRadius\`, a sun alone).
  if(directional&&!single&&pixel.info.opacity>=0.0){s=max(s,(1.0-pixel.info.opacity)*vsm.subsurfaceMinSourceRadius);}
  if(s==0.0){stepCount=0;}
  basis=frameAround(axis);
  let normalInFrame=intoFrame(basis,n);
  frameDepthSlope=-normalInFrame.xy/normalInFrame.z;
  uvDepthSlope=vsmDepthGradientUv(pd,pInMap,n);
  if(directional){
   ditherUv=select(vsmSunDitherUv(pd,length(viewPosition)),0.0,single);
  }else{
   let texel=vsmReceiverPixelSize(pd,pixel.sceneDepth);
   ditherWorld=select(vsm.traceDitherLocal*pd.ditherTexels*texel,0.0,single);
   biasCap=vsmLocalBiasCap(lightMap,texel,dist*dist,single);
  }
 }`

const traceLightRaysText = (lone: boolean) => /* wgsl */ `
 var missed=0u;
 var occluderSum=0.0;
 let rayCap=max(rays,1u);
 var stopped=false;
 var stopIndex=0u;
 // The march's step offset: the pixel's noise for every ray of a sun; a local light's rays each take
 // the next of a Sobol seed's congruential steps from it, the top 24 bits of the word.
 var stepOffset=pixel.noise;
 for(var i=0u;i<rayCap;i++){
  let running=traced&&!stopped;
  var hit=false;
  if(running){
   let noise4=vsmRayNoise4(pixel.pos,vsmView.frameIndex,i,rayCap);
   let dir=vsmConeDirection(basis,s,noise4.xy);
   // The start, within the dither square across the light. A local ray's is moved along the light
   // onto the receiver's plane (its slope in the light's frame), never more than the cap, in the
   // world; a sun ray's is moved in the map's UV once projected, and lifted to the centre of the
   // texel it starts in (\`vsmSunDitherBias\`).
   var start=lightMap.pInMap;
   var uvOffset=vec2f(0.0);
   if(directional){
    uvOffset=(noise4.zw-0.5)*ditherUv;
   }else if(ditherWorld>0.0){
    let square=(noise4.zw-0.5)*ditherWorld;
    let lift=min(vsm.tracePlaneBiasCap*ditherWorld,vsmPlaneLift(frameDepthSlope,square));
    start+=outOfFrame(vec3f(square,lift),basis);
   }
   let reach=select(lightReach*vsmLocalRayReach(dot(dir,axis)),lightReach,directional);
   // A sun's ray runs its whole reach from where its screen segment stopped; a local ray's ends at
   // its light's share (its start held under the reach, the 1e-6 in centimetres).
   let t0=select(min(startOffset,reach-1e-6*${VSM_UNIT_PER_CM}),startOffset,directional);
   let rayStart=start+dir*t0;
   let rayEnd=select(start+dir*reach,rayStart+dir*reach,directional);
   var bias=0.0;
   if(!directional){bias=vsmLocalPlaneBias(lightMap,rayStart,uvDepthSlope,biasCap);}
   else if(single){bias=vsmSunTapBias(lightMap,uvDepthSlope);}
   else{bias=vsmSunDitherBias(lightMap,rayStart,uvOffset,t0,uvDepthSlope);}
   var ray=vsmRayBegin(light,lightMap,rayStart,rayEnd,bias,uvOffset);
   var hitDepth=0.0;
   hit=vsmMarch(&ray,stepCount,stepOffset,&hitDepth);
   if(hit){occluderSum+=vsmRayOccluderDistance(&ray,hitDepth,length(rayStart));}
   else{missed|=1u<<i;}
   if(!directional){stepOffset=f32((bitcast<u32>(stepOffset)*0x915f77f5u+0x93d765ddu)>>8u)*${wgslF32(2 ** -24)};}
  }
${rayCountStatement(lone)} }
 if(traced){
  let rayCount=select(rayCap,min(stopIndex+1u,rayCap),stopped);
  let missCount=countOneBits(missed);
  result.shadowFactor=f32(missCount)/f32(rayCount);
  result.rayCount=rayCount;
  result.occluderDistance=occluderSum/f32(max(1u,rayCount-missCount));
 }
 return result;
}`

/** `vsmTraceLight`: light `light`'s share at receiver `pixel`, from the point `P` its normal bias
 *  moved it to. A ray's first segment is the screen's (`vsmScreenRayFrom`): its map segment starts
 *  where the image's depth says it stays unoccluded; it darkens nothing itself. A thin-subsurface
 *  receiver has no screen segment: its rays start the segment's length along. */
export const vsmTraceWgsl = ({
  pool,
  noise,
  hiz,
  lone,
  subgroups = false,
  kinds = VSM_TRACE_KINDS_BOTH,
}: VsmTraceHost) =>
  wgslBlock(
    `vsmTraceWgsl(${hiz.join(', ')}, ${lone}, ${subgroups}, ${kinds})`,
    [
      VSM_CONSTANTS_WGSL,
      Frame3,
      frameAround,
      intoFrame,
      outOfFrame,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmTraceLightWgsl(kinds),
      VSM_TRACE_COMMON_WGSL,
      VSM_TRACE_RESULT_WGSL,
      transformPoint,
      vsmScreenSegmentWgsl(hiz),
      vsmTraceMapWgsl(pool),
      vsmTraceRayWgsl(pool),
      vsmRayNoiseWgsl(noise),
      ...(lone ? [vsmLoneVoteWgsl(subgroups)] : []),
    ],
    `/** 'participating' = the lane takes part in the group's votes and traces. */
${traceLightSetupText}${traceLightRaysText(lone)}
`,
  )
