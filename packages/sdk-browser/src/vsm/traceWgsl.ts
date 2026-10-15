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
 * (`rayCountStatement`); a fragment's trace (`lone`) votes beside no other lane and proves no ray's
 * miss (its host binds no tile depths). Reads the view `vsmView` the host declares, the pages of
 * `pool` (`vsmPoolLoad`) and the noise pair `noise` provides (`vsmNoiseTwo`).
 * World unit = metre; a literal in centimetres is converted with `VSM_UNIT_PER_CM`.
 */
import { VSM_PROJECTION_LIGHT_STRUCT } from './projectionView.ts'
import { VSM_CONSTANTS_WGSL, VSM_UNIT_PER_CM } from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import {
  VSM_TRACE_COMMON_WGSL,
  VSM_TRACE_RESULT_WGSL,
  rayCountStatement,
  vsmRayNoiseWgsl,
} from './traceCommonWgsl.ts'
import { vsmTraceMapWgsl } from './traceMapWgsl.ts'
import { vsmRayMissesWgsl, vsmTraceRayWgsl } from './traceRayWgsl.ts'
import { VSM_TRACE_SPREAD_WGSL } from './traceSpreadWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLOAT32_MIN_NORMAL, SQRT2 } from '../../../math/src/wgsl/constants.ts'
import { transformPoint } from '../../../math/src/wgsl/projection.ts'
import { vsmScreenSegmentWgsl } from './traceScreenWgsl.ts'
import { Frame3, frameAround, intoFrame, outOfFrame } from '../../../math/src/wgsl/basis.ts'

/** A light of the projection, as its view uniform holds it (`projectionView.ts`): the traces' and
 *  the region test's (`vsmLightParticipates`). `radius` and `cosCone` are the lighting's range and
 *  cone (`localLightReaches`), `direction` points towards the light. */
export const VSM_TRACE_LIGHT_WGSL = wgslBlock(
  'VSM_TRACE_LIGHT_WGSL',
  [VSM_CONSTANTS_WGSL],
  `${VSM_PROJECTION_LIGHT_STRUCT}
fn vsmLightIsDirectional(light:VsmProjectionLight)->bool{return light.kind==LIGHT_KIND_DIRECTIONAL;}`,
)

/** What a host gives the trace (`vsmReceiverTraceWgsl`). */
export interface VsmTraceHost {
  /** The pool's `vsmPoolLoad` the rays sample. */
  pool: WgslDecl
  /** The rays' noise pair (`vsmNoiseTwo`). */
  noise: WgslDecl
  /** The depth pyramid's group and first binding (`hizDepthEntries`) the screen segment marches. */
  hiz: readonly [group: number, binding: number]
  /** A fragment's trace, which no other lane votes beside. */
  lone: boolean
}

/** `vsmTraceLight`: light `light`'s share at receiver `pixel`, from the point `P` its normal bias
 *  moved it to. A ray's first segment is the screen's (`vsmScreenRayCast`): its map segment starts
 *  where the image's depth says it stays unoccluded; it darkens nothing itself. A thin-subsurface
 *  receiver has no screen segment: its rays start the segment's length along. */
export const vsmTraceWgsl = ({ pool, noise, hiz, lone }: VsmTraceHost) =>
  wgslBlock(
    `vsmTraceWgsl(${hiz.join(', ')}, ${lone})`,
    [
      VSM_CONSTANTS_WGSL,
      Frame3,
      frameAround,
      intoFrame,
      outOfFrame,
      SQRT2,
      FLOAT32_MIN_NORMAL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_TRACE_LIGHT_WGSL,
      VSM_TRACE_COMMON_WGSL,
      VSM_TRACE_RESULT_WGSL,
      VSM_TRACE_SPREAD_WGSL,
      transformPoint,
      vsmScreenSegmentWgsl(hiz),
      vsmTraceMapWgsl(pool),
      vsmTraceRayWgsl(pool),
      vsmRayNoiseWgsl(noise),
      ...(lone ? [] : [vsmRayMissesWgsl(pool)]),
    ],
    `/** 'participating' = the lane takes part in the group's votes and traces. */
fn vsmTraceLight(light:VsmProjectionLight,pixel:VsmPixel,P:vec3f,participating:bool)->VsmTraceResult{
 let n=pixel.info.biasNormal;
 let directional=vsmLightIsDirectional(light);
 let toLight=light.shiftedPosition-P;
 let dist=length(toLight);
 let axis=select(toLight/dist,light.direction,directional);
 var result=vsmEmptyTrace();
 var traced=participating;
 var map:VsmLightMap;
 if(traced){map=vsmLightMapAt(light,P);traced=map.valid;}
 var pInMap=vec3f(0.0);
 var basis:Frame3;
 var s=0.0;
 var tanCone=0.0;
 var stepCount=VSM_TRACE_STEPS;
 var frameDepthSlope=vec2f(0.0);
 var uvDepthSlope=vec2f(0.0);
 var ditherWorld=0.0;
 var ditherCap=0.0;
 var biasCap=0.0;
 var eyeDistance=0.0;
 var spread=0.0;
 var startOffset=pixel.screenRayWorld;
 if(traced){
  if(!pixel.info.subsurface&&pixel.screenRayWorld>0.0){
   startOffset=vsmScreenRayCast(P,axis,pixel.screenRayWorld,pixel.screenRayWorld/vsmPixelWorldSize(pixel.sceneDepth,vsmView.viewToClip,vsmView.viewPixels.xy));
  }
  let pd=vsmProjectionOf(map.handle);
  pInMap=P+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmView.originShiftHigh,vsmView.originShiftLow);
  let viewPosition=transformPoint(vsmView.shiftedToView,P);
  eyeDistance=length(viewPosition);
  // The light's disk as the receiver sees it: a sun's sine of its angular radius, a local light's
  // emitter over its distance. A point source's rays all meet the map in one texel: one sample.
  s=select(min(light.sourceRadius/dist,1.0),light.sourceRadius,directional);
  tanCone=s*inverseSqrt(max(1.0-s*s,FLOAT32_MIN_NORMAL));
  if(s==0.0){stepCount=0;}
  basis=frameAround(axis);
  let normalInFrame=intoFrame(basis,n);
  frameDepthSlope=-normalInFrame.xy/normalInFrame.z;
  uvDepthSlope=vsmDepthGradientUv(pd,pInMap,n);
  let texel=vsmReceiverPixelSize(pd,pixel.sceneDepth);
  ditherWorld=VSM_TRACE_DITHER*pd.ditherTexels*texel;
  ditherCap=VSM_TRACE_PLANE_BIAS_CAP*ditherWorld;
  biasCap=VSM_TRACE_PLANE_BIAS_CAP*texel*vsmDepthPerDistance(pd,pInMap);
  spread=vsmRaySpread(axis,n,viewPosition);
 }
 var missCount=0u;
 let rayCap=u32(VSM_TRACE_RAYS);
 var stopped=false;
 var stopIndex=0u;
 for(var i=0u;i<rayCap;i++){
  let running=traced&&!stopped;
  var hit=false;
  // Whether the first ray hit an occluder near enough the receiver that every ray of the pixel falls
  // within one pixel of the others (\`vsmRaySpread\`).
  var narrow=false;
  if(running){
   let noise4=vsmRayNoise4(pixel.pos,vsmView.frameIndex,i,rayCap);
   let dir=vsmConeDirection(basis,s,noise4.xy);
   // The start, within the dither square across the light, moved along the light onto the
   // receiver's plane (its slope in the light's frame), never more than the cap.
   var start=pInMap;
   if(ditherWorld>0.0){
    let offset=(noise4.zw-0.5)*ditherWorld;
    start+=outOfFrame(vec3f(offset,min(ditherCap,2.0*max(0.0,dot(frameDepthSlope,offset)))),basis);
   }
   let reach=select(dist*vsmLocalRayReach(dot(dir,axis)),VSM_TRACE_REACH_SUN*eyeDistance,directional);
   // The 1e-6 is centimetres.
   let t0=min(startOffset,reach-1e-6*${VSM_UNIT_PER_CM});
   let rayStart=start+dir*t0;
   var depthBias=0.0;
   if(biasCap>0.0){depthBias=min(biasCap,vsmTexelPlaneBias(map,rayStart,uvDepthSlope));}
   var ray=vsmRayBegin(light,map,rayStart,start+dir*reach,depthBias);
   let jitter=vsmRayJitter(pixel.noise,i);
   // The projection proves its first ray alone (\`vsmRayMisses\`): a later one runs in a half where a
   // lane hit, whose march its lanes wait for, so a proof would save nothing.
   ${lone ? 'let proven=false;' : 'let proven=i==0u&&vsmRayMisses(&ray,stepCount,jitter);'}
   if(!proven){
    let march=vsmMarch(&ray,stepCount,jitter);
    hit=march.hitFound;
    if(hit&&i==0u){narrow=spread*(2.0*tanCone*vsmRayDistance(&ray,march.hitTime,t0,reach)+SQRT2*ditherWorld)<1.0;}
   }
   if(!hit){missCount+=1u;}
  }
${rayCountStatement(lone)} }
 if(traced){
  let rayCount=select(rayCap,min(stopIndex+1u,rayCap),stopped);
  result.shadowFactor=f32(missCount)/f32(rayCount);
  result.rayCount=rayCount;
 }
 return result;
}
`,
  )
