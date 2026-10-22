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
 * far end to its start (`vsmMarch`); the projection's first ray is first tested against the pages'
 * tile depths (`vsmRayMisses`), a proof that spares a scattered pool read (WebGPU has no texture
 * atomics: `traceRayWgsl.ts`), and marched only where
 * it fails; a fragment's host binds no tile depths. Where the host binds the translucent casters'
 * memory, each missed ray multiplies the panes it crosses (`vsmRayThrough`), averaged over the missed
 * rays: the colour of the light that passes, on the very rays the opaque share counts. Reads the view `vsmView` the host declares, the
 * pages of `pool` (`vsmPoolLoad`) and the blue noise `noise` declares (`blueNoiseVec2`).
 * World unit = metre; a literal in centimetres is converted with `VSM_UNIT_PER_CM`.
 */
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
import { vsmRayMissesWgsl, vsmTraceRayWgsl } from './traceRayWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../../math/src/wgsl/number.ts'
import { NO_INDEX } from '../../../../../../math/src/constants.ts'
import { transformPoint } from '../../../../../../math/src/wgsl/projection.ts'
import { vsmScreenSegmentWgsl } from './traceScreenWgsl.ts'
import { vsmTransmissionRayWgsl } from '../transmission/transmissionRayWgsl.ts'
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
  /** The translucent casters' memory block (`vsmTransmissionReadWgsl`): each missed ray then
   *  multiplies the panes it crosses (`vsmRayThrough`). */
  transmission?: WgslDecl
  /** The kinds of light it traces by default (`vsmTraceLightWgsl`), both unless given. */
  kinds?: number
}

/** A ray's direction and start (\`noise4\`, \`dir\`, \`start\`, \`reach\`), from ray \`i\`'s blue noise: the
 *  march's, and the panes' walk after it (\`THROUGH\`), the same ray. */
const RAY_SETUP = /* wgsl */ `   let noise4=vsmRayNoise4(pixel.pos,vsmView.frameIndex,i,rayCap);
   let dir=vsmConeDirection(basis,s,noise4.xy);
   // The start, within the dither square across the light, moved along the light onto the
   // receiver's plane (its slope in the light's frame), never more than the cap.
   var start=lightMap.pInMap;
   if(ditherWorld>0.0){
    let offset=(noise4.zw-0.5)*ditherWorld;
    start+=outOfFrame(vec3f(offset,min(ditherCap,2.0*max(0.0,dot(frameDepthSlope,offset)))),basis);
   }
   let reach=select(lightReach*vsmLocalRayReach(dot(dir,axis)),lightReach,directional);`

/** What the panes let through along the missed rays, averaged over them, after the march — none of
 *  its registers held while they are walked: the hull every ray lies in (its starts' dither square
 *  about the start, its cone's width at its reach about the far end) asks first which maps hold
 *  panes under it (\`vsmTPanedMaps\`), once; where
 *  one does, each missed ray (\`missed\`, bit i) is set up again and walked (\`vsmRayThrough\`). */
const THROUGH = /* wgsl */ `  if(missed!=0u){
   let spread=ditherWorld*${wgslF32(Math.SQRT1_2)}+ditherCap;
   let span=select(0.75*lightReach,lightReach,directional);
   let far=lightMap.pInMap+axis*span;
   let wide=spread+2.0*span*s;
   // One page cache for the hull and every ray walked after it: the same pages, read once.
   var pages:VsmTPages;pages.cache.map=${NO_INDEX}u;
   let paned=vsmTPanedMaps(&pages,light,lightMap,lightMap.pInMap,spread,far,wide);
   if(paned!=0u){
    var through=vec3f(0.0);
    for(var i=0u;i<rayCap;i++){
     if((missed&(1u<<i))==0u){continue;}
${RAY_SETUP}
     through+=vsmRayThrough(&pages,light,lightMap,start,start+dir*reach,paned);
    }
    result.through=through/f32(countOneBits(missed));
   }
  }
`

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
  transmission,
  kinds = VSM_TRACE_KINDS_BOTH,
}: VsmTraceHost) =>
  wgslBlock(
    `vsmTraceWgsl(${hiz.join(', ')}, ${lone}, ${subgroups}, ${transmission?.name ?? null}, ${kinds})`,
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
      ...(lone ? [vsmLoneVoteWgsl(subgroups)] : [vsmRayMissesWgsl(pool)]),
      ...(transmission ? [vsmTransmissionRayWgsl(pool, transmission)] : []),
    ],
    `/** 'participating' = the lane takes part in the group's votes and traces. */
fn vsmTraceLight(light:VsmProjectionLight,pixel:VsmPixel,receiver:VsmReceiver,participating:bool)->VsmTraceResult{
 let P=receiver.P;
 let n=pixel.info.biasNormal;
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
 var ditherCap=0.0;
 var planeBias=0.0;
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
  lightReach=select(dist,VSM_TRACE_REACH_SUN*length(viewPosition),directional);
  // The light's disk as the receiver sees it: a sun's sine of its angular radius, a local light's
  // emitter over its distance. A point source's rays all meet the map in one texel: one sample.
  s=select(min(light.sourceRadius/dist,1.0),light.sourceRadius,directional);
  if(single){s=0.0;}
  if(s==0.0){stepCount=0;}
  basis=frameAround(axis);
  let normalInFrame=intoFrame(basis,n);
  frameDepthSlope=-normalInFrame.xy/normalInFrame.z;
  let uvDepthSlope=vsmDepthGradientUv(pd,pInMap,n);
  let texel=vsmReceiverPixelSize(pd,pixel.sceneDepth);
  ditherWorld=select(VSM_TRACE_DITHER*pd.ditherTexels*texel,0.0,single);
  ditherCap=VSM_TRACE_PLANE_BIAS_CAP*ditherWorld;
  let texelUv=1.0/f32(select(vsmTexelsAtLevel(lightMap.mip),VSM_LEVEL0_TEXELS,lightMap.clipmap));
  planeBias=vsmPlaneBias(uvDepthSlope,texelUv,VSM_TRACE_PLANE_BIAS_CAP*texel*vsmDepthPerDistance(pd,lightMap.mapPoint.w));
 }
 var missed=0u;
 let rayCap=max(rays,1u);
 var stopped=false;
 var stopIndex=0u;
 for(var i=0u;i<rayCap;i++){
  let running=traced&&!stopped;
  var hit=false;
  if(running){
${RAY_SETUP}
   // The 1e-6 is centimetres.
   let t0=min(startOffset,reach-1e-6*${VSM_UNIT_PER_CM});
   let rayStart=start+dir*t0;
   var ray=vsmRayBegin(light,lightMap,start,rayStart,start+dir*reach,planeBias);
   let jitter=vsmRayJitter(pixel.noise,i);
   // The projection proves its first ray alone (\`vsmRayMisses\`): a later one runs in a half where a
   // lane hit, whose march its lanes wait for, so a proof would save nothing.
   ${lone ? 'hit=vsmMarch(&ray,stepCount,jitter);' : 'hit=!(i==0u&&vsmRayMisses(&ray,stepCount,jitter))&&vsmMarch(&ray,stepCount,jitter);'}
   if(!hit){missed|=1u<<i;}
  }
${rayCountStatement(lone)} }
 if(traced){
  let rayCount=select(rayCap,min(stopIndex+1u,rayCap),stopped);
  result.shadowFactor=f32(countOneBits(missed))/f32(rayCount);
  result.rayCount=rayCount;
${transmission ? THROUGH : ''} }
 return result;
}
`,
  )
