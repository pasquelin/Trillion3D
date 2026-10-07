/**
 * Rays traced through the shadow maps (a ray march over the stored depths):
 * - the samples, results, the additive 2D sequence over the blue noise and the trace settings;
 * - the ray march, instantiated per ray state by `vsmMarchWgsl`;
 * - the directional light's clipmap ray state, mapped clipmap, depth slope and light disk ray
 *   direction (its back-face test is every pass's, `VSM_PROJECTION_DATA_WGSL`);
 * - the spot light's single-face and two-cube-face ray states, local depth slope and texel-plane bias,
 *   resolution scale and clamped ray distance (its back-face test is every pass's);
 * - the projection common helpers: the receiver mip of local lights (their pixel footprint is
 *   every pass's), texel-plane bias and the one-sample paths (ray count 0);
 * - the sampling helpers: square-to-disk maps, the frame around a direction, the ray jitter step.
 *
 * Each fragment lists the declarations its text uses; the module brings what its host provides:
 * the page sampling (`vsmProjectionSampleWgsl` of its pool), `vsmNoiseTwo` (`vsmBlueNoiseWgsl`),
 * the bindings, and the view `vsmView`: the projection's uniform (`projectionWgsl.ts`), or the
 * view a fragment stage builds from its own pixel (`../lighting/direct/shadowWgsl.ts`, the traced
 * read of a blended surface), with the same fields.
 *
 * UNITS. World unit = metre. Where a world distance is compared with a literal in centimetres, the
 * literal is converted with `VSM_UNIT_PER_CM` (named at each place). Where a world distance is
 * related to a clipmap level (log2 of centimetres), the distance is converted to centimetres. Clip
 * and UV quantities are unitless and unchanged.
 */
import { VSM_PLASTIC_STEP } from './blueNoise.ts'
import { VSM_CONSTANTS_WGSL, VSM_F32_BELOW_ONE, VSM_UNIT_PER_CM } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_STRUCTS_WGSL,
} from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLOAT32_MAX, PI } from '../../../math/src/wgsl/constants.ts'
import { sinFromCosUnclamped } from '../../../math/src/wgsl/geometry.ts'
import {
  Frame3,
  frameAround,
  intoFrame,
  outOfFrame,
  tangentAcross,
} from '../../../math/src/wgsl/basis.ts'

const CM = `${VSM_UNIT_PER_CM}`

/**
 * The ray march, instantiated for one ray state: from the ray's far end to its start, each step
 * reads the depth the map stores under the ray and compares it with the ray's own depth there. It
 * holds the last stored depth it saw and the slope from the one before; where a stored depth lies
 * far behind the ray (past the tolerance), the occluder held is extended along that slope instead
 * (`extrapolate`, where the slope cap is above 0). `findSample(ptr<function,State>, time)` returns
 * a `VsmMarchStep` with `marchRayDepth` always set.
 */
const vsmMarchWgsl = (name: string, state: string, findSample: string) =>
  wgslBlock(
    `vsmMarchWgsl(${name})`,
    [VSM_TRACE_COMMON_WGSL],
    `
fn ${name}(rayState:ptr<function,${state}>,stepCount:i32,stepJitter:f32,extrapolate:bool)->VsmMarchHit{
 // Declared: a value far from every stored depth (device depths lie in [0, 1]): nothing held yet.
 let noHistory=-10000.0;
 var heldDepth=noHistory;
 var heldTime=-1.0;
 var heldSlope=0.0;
 let time=vsmMarchTimeLine(stepCount,stepJitter);
 var prevRayDepth=-1.0;
 for(var i=0;i<=stepCount;i++){
  let rayTime=vsmMarchTime(i,stepCount,time);
  let s=${findSample}(rayState,rayTime);
  let marchRayDepth=s.marchRayDepth;
  if(s.restartSlope){heldSlope=s.slopeCap;}
  if(s.valid){
   let storedDepth=s.storedDepth;
   if(heldDepth==noHistory){
    heldDepth=storedDepth;
    heldTime=rayTime;
    if(storedDepth>marchRayDepth){return VsmMarchHit(true,storedDepth);}
   }else{
    let rayDepthStep=marchRayDepth-prevRayDepth;
    // Declared: the comparison's tolerance, 5 % over the ray's depth step between two samples.
    let toleranceScale=1.05;
    let depthTolerance=abs(rayDepthStep)*toleranceScale;
    let farBehind=(storedDepth-marchRayDepth)>depthTolerance;
    var comparedDepth=storedDepth;
    let sinceHeld=rayTime-heldTime;
    if(farBehind){
     if(extrapolate){comparedDepth=heldSlope*sinceHeld+heldDepth;}
     else{comparedDepth=heldDepth;}
    }else{
     if(storedDepth!=heldDepth){
      let slopeLimit=s.slopeCap;
      // clamp as min(max(x,lo),hi): defined also when lo > hi, which WGSL's clamp is not.
      heldSlope=min(max((storedDepth-heldDepth)/sinceHeld,-slopeLimit),slopeLimit);
      heldDepth=storedDepth;
      heldTime=rayTime;
     }
    }
    let depthGap=marchRayDepth-comparedDepth;
    let halfTolerance=0.5*depthTolerance;
    if(abs(depthGap+halfTolerance)<halfTolerance){return VsmMarchHit(true,storedDepth);}
   }
   prevRayDepth=marchRayDepth;
  }
 }
 return VsmMarchHit(false,0.0);
}
`,
  )

/** The traces' common helpers and the ray jitter step. */
export const VSM_TRACE_COMMON_WGSL = wgslBlock(
  'VSM_TRACE_COMMON_WGSL',
  [PI, FLOAT32_MAX, frameAround, VSM_STRUCTS_WGSL, VSM_PROJECTION_DATA_WGSL],
  `
struct VsmMarchStep{valid:bool,storedDepth:f32,marchRayDepth:f32,slopeCap:f32,restartSlope:bool,}
fn vsmEmptyStep()->VsmMarchStep{return VsmMarchStep(false,0.0,0.0,0.0,false);}
/** A march's result: whether it hit and, where it did, the stored depth of the sample that hit —
 *  the occluder's surface over that sample, in the ray's depth space (the sun's penumbra test,
 *  \`vsmSunRaySpread\`). */
struct VsmMarchHit{hitFound:bool,occluderDepth:f32,}
/** The march's sample times: t² with t = a·i + b (the two words returned, a = −1/stepCount), from
 *  the far end (i = 0) to the ray's start (i = stepCount, time 0), each step jittered by \`stepJitter\`. */
fn vsmMarchTimeLine(stepCount:i32,stepJitter:f32)->vec2f{
 let timeScale=-1.0/f32(stepCount);
 return vec2f(timeScale,1.0+(1.0-stepJitter)*timeScale);
}
fn vsmMarchTime(i:i32,stepCount:i32,time:vec2f)->f32{
 if(i==stepCount){return 0.0;}
 let t=time.x*f32(i)+time.y;
 return t*t;
}
/** Point n of the additive 2D sequence (\`VSM_PLASTIC_STEP\`): its points spread evenly over the
 *  unit square. */
fn vsmAdditive2d(n:i32)->vec2f{return fract(f32(n)*vec2f(${VSM_PLASTIC_STEP[0]},${VSM_PLASTIC_STEP[1]}));}
/** Four blue-noise random values for a pixel, sample and frame (two reads of the blue-noise texture, offset by the additive sequence). */
fn vsmRayNoise4(pixelPos:vec2u,timeIndex:u32,rayIndex:u32,rayTotal:u32)->vec4f{
 let dims=vec2f(VSM_NOISE_TILE.xy);
 let offset1=vec2i(vsmAdditive2d(i32(rayIndex))*dims);
 let offset2=vec2i(vsmAdditive2d(i32(rayIndex+rayTotal))*dims);
 return vec4f(vsmNoiseTwo(pixelPos+bitcast<vec2u>(offset1),timeIndex),vsmNoiseTwo(pixelPos+bitcast<vec2u>(offset2),timeIndex));
}
/** The ray count, samples per ray, extrapolation slope and dither scale of a trace. */
struct VsmTraceSetup{voteAfter:i32,rayCount:i32,stepsPerRay:i32,slopeCapSetting:f32,ditherTexels:f32,}
fn vsmTraceSetupSun()->VsmTraceSetup{
 return VsmTraceSetup(i32(vsm.traceVoteAfter),vsm.traceRaysSun,vsm.traceStepsSun,vsm.traceSlopeCapSun,vsm.traceDitherSun);
}
fn vsmTraceSetupLocal()->VsmTraceSetup{
 return VsmTraceSetup(i32(vsm.traceVoteAfter),vsm.traceRaysLocal,vsm.traceStepsLocal,vsm.traceSlopeCapLocal,vsm.traceDitherLocal);
}
/** The smallest normal f32, 2^-126: added to a nonzero |p| (2^-25 at least, for E in [0, 1)) it
 *  rounds back to it, so it changes no quotient, and the square's centre gives 0 rather than 0/0. */
const VSM_F32_MIN_NORMAL:f32=1.17549435e-38;
/** Maps the unit square onto the unit disk, each square ring onto a circle: the unit direction
 *  and the radius (the ring). The ring is the larger coordinate; the angle runs over the eighth of
 *  the circle the smaller one's share sets, turned a quarter where y is the larger, and the
 *  direction takes the quadrant of the point's signs. */
fn vsmSquareToDiskPolar(E:vec2f)->vec3f{
 // 1 − 2^-24, the greatest f32 below 1, as its decimal.
 let p=2.0*E-${VSM_F32_BELOW_ONE};
 let a=abs(p);
 let lo=min(a.x,a.y);
 let hi=max(a.x,a.y);
 let phi=(PI/4.0)*(lo/(hi+VSM_F32_MIN_NORMAL)+select(0.0,2.0,a.y>=a.x));
 let quadrant=select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0));
 return vec3f(abs(vec2f(cos(phi),sin(phi)))*quadrant,hi);
}
/** A uniform point on the unit disk: the square's point taken ring to circle. */
fn vsmSquareToDisk(E:vec2f)->vec2f{let r=vsmSquareToDiskPolar(E);return r.xy*r.z;}
/** A cheaper map of the square onto the disk, without trigonometry. */
fn vsmSquareToDiskFast(E:vec2f)->vec2f{
 var sf=E*sqrt(2.0)-sqrt(0.5);
 let sq=sf*sf;
 let root=sqrt(2.0*max(sq.x,sq.y)-min(sq.x,sq.y));
 if(sq.x>sq.y){sf.x=select(-root,root,sf.x>0.0);}
 else{sf.y=select(-root,root,sf.y>0.0);}
 return sf;
}
/** The next ray's jitter bits: one step of a linear congruential generator modulo 2^32. Declared,
 *  without derivation: its multiplier and increment set every local ray's sample jitter after the
 *  first; another pair moves every penumbra pixel's noise. */
fn vsmNextRayJitter(seed:u32)->u32{return seed*0x915f77f5u+0x93d765ddu;}
/** A displacement \`e\` across the light (\`l\`), carried along the light onto the receiver's plane
 *  (normal \`n\`, \`nl\` = n·l > 0), then onto the screen in pixels: \`ndc\` and \`toPixels\` are the
 *  receiver's (\`vsmSunRaySpread\`). The plane's point is e − l (n·e)/(n·l); its screen offset is
 *  the derivative of clip.xy / clip.w, (Δclip.xy − ndc Δclip.w) / clip.w, exact for a perspective or
 *  an orthographic view, off-centre terms included. */
fn vsmAcrossLightOnScreen(e:vec3f,l:vec3f,n:vec3f,nl:f32,ndc:vec2f,toPixels:vec2f)->vec2f{
 let onPlane=e-l*(dot(n,e)/nl);
 let c=vsmView.viewToClip*vec4f((vsmView.shiftedToView*vec4f(onPlane,0.0)).xyz,0.0);
 return (c.xy-ndc*c.w)*toPixels;
}
/**
 * How far apart on screen, in pixels, a sun ray's samples can fall from another's of the same
 * pixel, per world unit of the occluder's height over the receiver (\`x\`) and for the texel
 * dither (\`y\`): a pixel whose occluder is \`h\` high spreads its rays over x·h + y pixels.
 * - Across the light, at height h, a ray leans at most h·s off the light's line through the
 *   receiver (\`vsmSunDiskRayDirection\`: the disk's offset is s·r·|diskSide| ≤ s per unit along the
 *   light): any two rays lie within 2·h·s. Their start's dither (\`texelShift\`, a square of side
 *   \`ditherUv\` in UV) adds its diagonal, √2·ditherUv / (UV per world unit).
 * - A displacement across the light reaches the receiver along the light, then the screen
 *   (\`vsmAcrossLightOnScreen\`): a linear map whose largest stretch σ is the root of the greatest
 *   eigenvalue of the 2×2 Gram matrix of the images of two orthonormal directions across the light.
 * Where the receiver faces away from the light or is edge-on (n·l ≤ 0, or not a number) the spread
 * is unbounded: f32's greatest value.
 */
fn vsmSunRaySpread(l:vec3f,s:f32,n:vec3f,viewPosition:vec3f,ditherUv:f32,uvPerWorld:f32)->vec2f{
 let nl=dot(n,l);
 if(!(nl>0.0)){return vec2f(FLOAT32_MAX);}
 let clip=vsmView.viewToClip*vec4f(viewPosition,1.0);
 let ndc=clip.xy/clip.w;
 let toPixels=0.5*vsmView.viewPixels.xy/clip.w;
 let across=frameAround(l);
 let a=vsmAcrossLightOnScreen(across.x,l,n,nl,ndc,toPixels);
 let b=vsmAcrossLightOnScreen(across.y,l,n,nl,ndc,toPixels);
 let g=vec3f(dot(a,a),dot(b,b),dot(a,b));
 let d=0.5*(g.x-g.y);
 let sigma=sqrt(0.5*(g.x+g.y)+sqrt(d*d+g.z*g.z));
 return sigma*vec2f(2.0*s,sqrt(2.0)*ditherUv/uvPerWorld);
}
/** The mip level of a local light for a receiver (its footprint, or 0 without a receiver cover). */
fn vsmLocalMipAt(pd:VsmProjectionData,receiverInMap:vec3f,receiverDepthEye:f32)->u32{
 if(pd.useCover){
  let footprint=vsmLocalPixelFootprint(pd,receiverInMap,receiverDepthEye,vsmView.viewToClip,vsmView.viewPixels.xy);
  return vsmLocalMipLevel(footprint,pd.levelBias,vsm.pressureBias,0.0);
 }
 return 0u;
}
`,
)

/** The clipmap ray's state and helpers. */
export const VSM_TRACE_DIRECTIONAL_WGSL = wgslBlock(
  'VSM_TRACE_DIRECTIONAL_WGSL',
  [
    VSM_TRACE_COMMON_WGSL,
    tangentAcross,
    VSM_HANDLE_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    VSM_PROJECTION_DATA_READ_WGSL,
    vsmMarchWgsl('vsmMarchSun', 'VsmSunRay', 'vsmSunRayStep'),
  ],
  `
/** The depth slope in UV of the surface (the shading normal stands in for the geometric one). */
fn vsmSunDepthGradientUv(pd:VsmProjectionData,planeNormal:vec3f)->vec2f{
 let planeUv=pd.planesToMapUv*vec4f(planeNormal,0.0);
 let uvDepthSlope=-planeUv.xy/planeUv.z;
 // Declared: the steepest depth gradient, in depth per UV, a texel offset is biased along.
 let c=vec2f(0.05);
 return min(max(uvDepthSlope,-c),c);
}
/** The slope bias that keeps a ray off the surface's own texel plane. */
fn vsmSunTexelPlaneBias(uvDepthSlope:vec2f,uvOffset:vec2f)->f32{return 2.0*max(0.0,dot(uvDepthSlope,uvOffset));}
/** The clipmap level a position is mapped on, invalid past the last. It reads no pool word: the
 *  level its texel is mapped on is told by the page's words (\`vsmClipmapTexel\`). */
fn vsmMappedLevel(h:VsmHandle,rayOrigin:vec3f)->VsmHandle{
 let base=vsmProjectionOf(h);
 let d2=vsmDistanceSqToOrigin(base,rayOrigin,vsmView.originShiftHigh,vsmView.originShiftLow);
 let levelReal=vsmSampledLevel(base,d2);
 var levelIndex=max(0,i32(floor(levelReal))-base.mapLevel);
 if(levelIndex>=base.levelsLeft){return vsmHandleInvalid();}
 let levelMap=vsmHandleOffset(h,levelIndex);
 let pd=vsmProjectionOf(levelMap);
 let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmView.originShiftHigh,vsmView.originShiftLow);
 let sunUvzStart=(pd.shiftedToMapUv*vec4f(rayOrigin+toMapShift,1.0)).xyz;
 let t=vsmClipmapTexel(levelMap,vsmClipmapPage(levelMap,vsmClipmapBasePage(sunUvzStart.xy)),sunUvzStart.xy);
 if(t.valid&&t.levelHandle.id>levelMap.id){levelIndex+=i32(t.levelHandle.id-levelMap.id);}
 return vsmHandleOffset(h,levelIndex);
}
/** The state of a ray through a clipmap level. */
struct VsmSunRay{
 levelMap:VsmHandle,
 sunUvzStart:vec3f,
 sunUvzStep:vec3f,
 slopeCap:f32,
}
/**
 * Starts a sun ray. Its slope cap (\`VSM_TRACE_SLOPE_CAP_SUN\`) is a depth per unit of ray time
 * through lightViewToClip[2][2], which is per centimetre in the level arithmetic and per metre in
 * the world, so the cap is converted (·${CM}) to clamp the clip-space slope the centimetre value gives.
 */
fn vsmSunRayBegin(pd:VsmProjectionData,originInMap:vec3f,rayDir:vec3f,rayLength:f32,startOffset:f32,uvDepthSlope:vec2f,texelShift:vec2f,slopeCap:f32)->VsmSunRay{
 let rayStart=originInMap+rayDir*startOffset;
 let rayVector=rayDir*rayLength;
 var sunUvzStart=(pd.shiftedToMapUv*vec4f(rayStart,1.0)).xyz;
 let sunUvzStep=(pd.shiftedToMapUv*vec4f(rayVector,0.0)).xyz;
 var planeBias=vsmSunTexelPlaneBias(uvDepthSlope,texelShift);
 planeBias=max(0.0,planeBias-abs(startOffset*pd.lightViewToClip[2][2]));
 sunUvzStart=vec3f(sunUvzStart.xy+texelShift,sunUvzStart.z+planeBias);
 var r:VsmSunRay;
 r.levelMap=pd.handle;
 r.sunUvzStart=sunUvzStart;
 r.sunUvzStep=sunUvzStep;
 r.slopeCap=abs(slopeCap*${CM}*pd.lightViewToClip[2][2]);
 return r;
}
/** A sun ray's sample at \`rayTime\`: its shadow UV and the depth it is compared at. */
fn vsmSunRayUvz(rayState:ptr<function,VsmSunRay>,rayTime:f32)->vec3f{
 return (*rayState).sunUvzStart+(*rayState).sunUvzStep*rayTime;
}
fn vsmSunRayStep(rayState:ptr<function,VsmSunRay>,rayTime:f32)->VsmMarchStep{
 let sunUvz=vsmSunRayUvz(rayState,rayTime);
 let sunRead=vsmReadClipmap((*rayState).levelMap,sunUvz.xy);
 var s=vsmEmptyStep();
 s.valid=sunRead.valid;
 s.marchRayDepth=sunUvz.z;
 s.slopeCap=(*rayState).slopeCap;
 if(sunRead.valid){s.storedDepth=sunRead.depth;}
 return s;
}
/** A ray direction in the light's disk. lightDirection points to the light; sourceRadius is the sine of the half angle. */
fn vsmSunDiskRayDirection(lightDirection:vec3f,sourceRadius:f32,E:vec2f)->vec3f{
 var rayDir=lightDirection;
 let diskUv=vsmSquareToDisk(E)*sourceRadius;
 let N=rayDir;
 let diskSide=tangentAcross(N);
 let diskUp=cross(diskSide,N);
 rayDir+=diskSide*diskUv.x+diskUp*diskUv.y;
 return normalize(rayDir);
}
`,
)

/** The local lights' ray states and helpers. */
export const VSM_TRACE_LOCAL_WGSL = wgslBlock(
  'VSM_TRACE_LOCAL_WGSL',
  [
    VSM_TRACE_COMMON_WGSL,
    sinFromCosUnclamped,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_PAGE_LOOKUP_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    VSM_PROJECTION_DATA_READ_WGSL,
    vsmMarchWgsl('vsmMarchFace', 'VsmFaceRay', 'vsmFaceRayStep'),
    vsmMarchWgsl('vsmMarchCrossFace', 'VsmCrossFaceRay', 'vsmCrossFaceRayStep'),
  ],
  `
/** The depth slope in UV of the surface at a position. */
fn vsmLocalDepthGradientUv(h:VsmHandle,pointInMap:vec3f,worldNormal:vec3f)->vec2f{
 let pd=vsmProjectionOf(h);
 let planeInMap=vec4f(worldNormal,-dot(worldNormal,pointInMap));
 let planeUv=pd.planesToMapUv*planeInMap;
 return -planeUv.xy/planeUv.z;
}
/** The slope bias of a local light's ray. */
fn vsmLocalTexelPlaneBias(h:VsmHandle,pointInMap:vec3f,uvDepthSlope:vec2f)->f32{
 let pd=vsmProjectionOf(h);
 var mapUvz=pd.shiftedToMapUv*vec4f(pointInMap,1.0);
 mapUvz=vec4f(mapUvz.xyz/mapUvz.w,mapUvz.w);
 let page=vsmLocalPageAt(pd.handle,mapUvz.xy,pd.finestMip);
 let mipTexels=f32(vsmTexelsAtLevel(page.coarserLevels));
 let texelMid=vec2f(page.mapTexelXY)+0.5;
 let uvToMid=(texelMid-page.mapTexelPos)/mipTexels;
 return 2.0*max(0.0,dot(uvDepthSlope,uvToMid));
}
/** The state of a ray through one cube face or one spot map. */
struct VsmFaceRay{
 handle:VsmHandle,
 faceUvzStart:vec3f,
 faceUvzStep:vec3f,
 slopeCap:f32,
 finestMip:u32,
}
/** Starts a single-face ray. */
fn vsmFaceRayBegin(h:VsmHandle,startInMap:vec3f,endInMap:vec3f,slopeCap:f32,depthBias:f32,mipLevel:u32,clampUv:bool)->VsmFaceRay{
 let pd=vsmProjectionOf(h);
 let s4=pd.shiftedToMapUv*vec4f(startInMap,1.0);
 let e4=pd.shiftedToMapUv*vec4f(endInMap,1.0);
 var faceUvzStart=s4.xyz/s4.w;
 let faceUvzEnd=e4.xyz/e4.w;
 let faceUvzStep=faceUvzEnd-faceUvzStart;
 if(clampUv){faceUvzStart=vec3f(saturate(faceUvzStart.xy),faceUvzStart.z);}
 faceUvzStart.z+=depthBias;
 var r:VsmFaceRay;
 r.handle=h;
 r.faceUvzStart=faceUvzStart;
 r.faceUvzStep=faceUvzStep;
 r.slopeCap=slopeCap*faceUvzStep.z;
 r.finestMip=max(mipLevel,pd.finestMip);
 return r;
}
/** The sample of a single-face ray at a time. */
fn vsmFaceRayStep(rayState:ptr<function,VsmFaceRay>,rayTime:f32)->VsmMarchStep{
 let faceUvz=(*rayState).faceUvzStart+(*rayState).faceUvzStep*rayTime;
 var s=vsmEmptyStep();
 s.valid=false;
 s.marchRayDepth=faceUvz.z;
 s.slopeCap=(*rayState).slopeCap;
 if(all(faceUvz.xy==saturate(faceUvz.xy))){
  let h=(*rayState).handle;
  let sm=vsmReadAt(h,vsmLocalPageAt(h,faceUvz.xy,(*rayState).finestMip));
  if(sm.valid){
   s.valid=true;
   s.storedDepth=sm.depth;
  }
 }
 return s;
}
/** The state of a ray through two cube faces. */
struct VsmCrossFaceRay{face0:VsmFaceRay,face1:VsmFaceRay,inFace1:bool,}
/** Starts a two-face ray. */
fn vsmCrossFaceRayBegin(h0:VsmHandle,h1:VsmHandle,rayStart:vec3f,rayEnd:vec3f,slopeCap:f32,depthBias:f32,mipLevel:u32)->VsmCrossFaceRay{
 return VsmCrossFaceRay(
  vsmFaceRayBegin(h0,rayStart,rayEnd,slopeCap,depthBias,mipLevel,false),
  vsmFaceRayBegin(h1,rayStart,rayEnd,slopeCap,depthBias,mipLevel,false),
  true);
}
/** The sample of a two-face ray: traces from END to START, so it starts in face 1. */
fn vsmCrossFaceRayStep(rayState:ptr<function,VsmCrossFaceRay>,rayTime:f32)->VsmMarchStep{
 var s=vsmEmptyStep();
 var face0=(*rayState).face0;
 var face1=(*rayState).face1;
 if((*rayState).inFace1){
  s=vsmFaceRayStep(&face1,rayTime);
  if(!s.valid){
   s=vsmFaceRayStep(&face0,rayTime);
   s.restartSlope=true;
   (*rayState).inFace1=false;
  }
 }else{
  s=vsmFaceRayStep(&face0,rayTime);
 }
 (*rayState).face0=face0;
 (*rayState).face1=face1;
 return s;
}
/** The shadow resolution scale at a depth. The 0.1 floor is 0.1 cm (·${CM}). */
fn vsmReceiverPixelSize(pd:VsmProjectionData,sceneDepth:f32)->f32{
 let pixelWorldHere=vsmPixelWorldSize(sceneDepth,vsmView.viewToClip,vsmView.viewPixels.xy);
 return max(0.1*${CM},pixelWorldHere*exp2(pd.levelBias));
}
/** The clamp on a local light's ray distance by the cosine of the angle. */
fn vsmLocalRayReach(cosTheta:f32)->f32{
 // Declared: a local ray stops at three quarters of the way to the light, sooner off its axis.
 let sinTheta=sinFromCosUnclamped(cosTheta);
 return 0.75*saturate(1.5/(cosTheta+vsm.traceConeCot*sinTheta));
}
`,
)

/** The light the traces read, as the projection's view uniform holds it (four a dispatch); a pass
 *  that traces from its own lights builds one. */
export const VSM_TRACE_LIGHT_WGSL = wgslBlock(
  'VSM_TRACE_LIGHT_WGSL',
  [],
  `struct VsmProjectionLight{
 shiftedPosition:vec3f,
 invRadius:f32,
 direction:vec3f,
 sourceRadius:f32,
 spotAngles:vec2f,
 mapId:i32,
 kind:u32,
}`,
)

/**
 * Whether this sun ray provably misses, from its samples' tiles alone (`tileDepths`):
 * every valid sample it would take is at or above (no closer to the light than) the closest depth
 * of the tile of 8×8 pool texels its texel is in. A march (`vsmMarchSun`) whose every
 * valid sample has storedDepth ≤ marchRayDepth returns no hit: its first valid sample hits only
 * for storedDepth > marchRayDepth; a later one is never behind (storedDepth − marchRayDepth ≤ 0
 * ≤ its tolerance), so it compares its own depth, and hits only for marchRayDepth < storedDepth;
 * f32 keeps both signs (rounding is monotonic). A tile's word is the greatest of its texels' words
 * whose float is not below 0 (a texel below 0, or NaN, never hits: any bound holds it), so its
 * float bounds each texel's, and taken to the sampled level as a texel's raw depth is
 * (`vsmClipmapTexelDepth`) it bounds each sample's depth. The samples are the march's own: the
 * same times, UVs, pages and texels (`vsmMarchTime`, `vsmSunRayUvz`,
 * `vsmClipmapTexel`), nearest the receiver first, where an occluder ends the test soonest; a
 * tile is read once for the samples in a row inside it. Not proven: that a GPU compiler evaluates
 * those helpers to the same bits at both call sites (it may fuse a multiply-add at one alone); the
 * tests run them in JavaScript.
 */
const CLIPMAP_RAY_MISSES = wgslBlock(
  'CLIPMAP_RAY_MISSES',
  [VSM_TRACE_COMMON_WGSL, VSM_TRACE_DIRECTIONAL_WGSL, VSM_PAGE_ADDRESS_WGSL],
  `
fn vsmSunRayMisses(rayState:ptr<function,VsmSunRay>,stepCount:i32,stepJitter:f32)->bool{
 let time=vsmMarchTimeLine(stepCount,stepJitter);
 var tile=0xFFFFFFFFu;
 var raw=0.0;
 for(var i=stepCount;i>=0;i--){
  let sunUvz=vsmSunRayUvz(rayState,vsmMarchTime(i,stepCount,time));
  let t=vsmClipmapTexel((*rayState).levelMap,vsmClipmapPage((*rayState).levelMap,vsmClipmapBasePage(sunUvz.xy)),sunUvz.xy);
  if(t.valid){
   let k=vsmTileDepthIndex(t.poolTexel);
   if(k!=tile){tile=k;raw=bitcast<f32>(vsmTileDepthsLoad(k));}
   if(!(vsmClipmapTexelDepth(t,raw)<=sunUvz.z)){return false;}
  }
 }
 return true;
}
`,
)
/**
 * A light's ray count (the adaptive ray count) under `guard`, decided after the first ray.
 * - A lane whose first ray hit an occluder whose rays fall within one pixel (`narrow`, false
 *   where the trace measures no spread) stops there, alone: its other rays would sample the
 *   occluder's shadow inside its own pixel, so they would change it only below the pixel.
 * - With the votes, a lane whose first ray missed has no occluder of its own to measure: it stops
 *   where no lane of its 32-pixel half hit a wide one (`vsmVoteAllTrue`), and goes on, as a lane
 *   that hit a wide one does, where one did — it may lie in that penumbra. Without the votes (a
 *   fragment stage) it goes on.
 * - With the votes, at the adaptive count, a half all of whose lanes' rays hit so far (an umbra)
 *   stops. It is asked there alone: a half it does not stop holds a lane that missed, which votes
 *   no at every later ray (`missCount` never falls) and so is never stopped; a later vote could
 *   stop no lane (`projectionUmbraVote.test.ts`).
 * The group leaves the loop where both halves stopped (`vsmGroupVoted`): every lane idle, the
 * rays left trace nothing. A half stops at the first vote or the umbra one only, so the group
 * asks there, unless the loop ends anyway (`projectionGroupExit.test.ts`).
 */
const rayCountStatement = (
  guard: string,
  waveVotes: boolean,
) => /* wgsl */ `  if(${guard}&&i==0u&&running&&hit&&narrow){stopped=true;}
${
  waveVotes
    ? `  if(${guard}){
   var halfStops=false;
   if(i==0u){halfStops=vsmVoteAllTrue(!running||!hit||narrow,voteSplit);}
   else if(i==u32(settings.voteAfter)){halfStops=vsmVoteAllTrue(!running||missCount==0u,voteSplit);}
   if(halfStops&&running){stopped=true;stopIndex=i;}
   if((i==0u||i==u32(settings.voteAfter))&&i+1u<rayCap&&vsmGroupVoted(halfStops)){break;}
  }
`
    : ''
}`

/**
 * The traces of one light at one pixel, directional and local, over the ray casts above: the rays
 * across the light's disk or sphere, each texel-dithered and marched, their share of misses the
 * shadow factor. With `waveVotes`, the compute projection's: a 32-pixel half of a group votes
 * (`vsmVoteAllTrue`) to stop its rays early, and to trace a point light's rays across two cube
 * faces when any of its rays crosses. Without, a fragment stage's, which has no wave on the web's
 * base path: every ray is traced but where the first one hit an occluder whose rays fall within the
 * pixel (`rayCountStatement`), and each pixel takes two faces only where its own ray crosses.
 * The votes take the trace's `voteSplit`, uniform: whether they count by barrier (`voteWgsl`); a
 * fragment stage passes true, unread. With the votes, a group leaves its loops at once
 * where both its halves stopped (`rayCountStatement`).
 * Reads the view `vsmView` the module declares.
 */
export const vsmTraceWgsl = (waveVotes: boolean) =>
  wgslBlock(
    `vsmTraceWgsl(${waveVotes})`,
    [
      VSM_CONSTANTS_WGSL,
      Frame3,
      frameAround,
      intoFrame,
      outOfFrame,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_TRACE_LIGHT_WGSL,
      VSM_TRACE_COMMON_WGSL,
      VSM_TRACE_DIRECTIONAL_WGSL,
      VSM_TRACE_LOCAL_WGSL,
      VSM_TRACE_RESULT_WGSL,
      ...(waveVotes ? [CLIPMAP_RAY_MISSES] : []),
    ],
    `/** Traces the sun's rays. 'participating' = the lane takes part in the group's votes. */
fn vsmTraceSun(mapId:i32,light:VsmProjectionLight,pixelPos:vec2u,shiftedPosition:vec3f,startOffset:f32,noise:f32,worldNormal:vec3f,participating:bool,voteSplit:bool)->VsmTraceResult{
 let settings=vsmTraceSetupSun();
 let h=vsmHandleFromIdDirectional(u32(mapId));
 var result=vsmEmptyTrace();
 result.valid=true;
 result.shadowFactor=1.0;
 var traced=participating;
 var levelMap=vsmHandleInvalid();
 if(traced){
  levelMap=vsmMappedLevel(h,shiftedPosition);
  if(!vsmHandleIsValid(levelMap)){traced=false;}
 }
 var pd:VsmProjectionData;
 var ditherUv=0.0;
 var uvDepthSlope=vec2f(0.0);
 var rayLength=0.0;
 var originInMap=vec3f(0.0);
 var receiverDepth=0.0;
 var spreadPerDepth=0.0;
 var spreadDither=0.0;
 if(traced){
  pd=vsmProjectionOf(levelMap);
  let viewPosition=(vsmView.shiftedToView*vec4f(shiftedPosition,1.0)).xyz;
  let eyeDistance=length(viewPosition);
  let ditherHere=f32(settings.ditherTexels)*pd.ditherTexels;
  if(ditherHere>0.0){
   // The clipmap level is log2 of centimetres: the distance enters in centimetres.
   ditherUv=((0.5/f32(vsmTexelsAtLevel(0u)))*ditherHere*(eyeDistance*VSM_CM_PER_UNIT))/exp2(f32(pd.mapLevel)-pd.levelBias);
  }
  uvDepthSlope=vsmSunDepthGradientUv(pd,worldNormal);
  rayLength=vsm.traceReachSun*eyeDistance;
  let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmView.originShiftHigh,vsmView.originShiftLow);
  originInMap=shiftedPosition+toMapShift;
  // The rays' spread on screen (\`vsmSunRaySpread\`), per unit of the depth an occluder lies above
  // the receiver: the UV matrix's depth row is the light's line, its length the depth per world unit.
  let uv=pd.shiftedToMapUv;
  receiverDepth=(uv*vec4f(originInMap,1.0)).z;
  let spread=vsmSunRaySpread(light.direction,light.sourceRadius,worldNormal,viewPosition,ditherUv,length(vec3f(uv[0][0],uv[1][0],uv[2][0])));
  spreadPerDepth=spread.x/length(vec3f(uv[0][2],uv[1][2],uv[2][2]));
  spreadDither=spread.y;
 }
 var missCount=0u;
 let rayCap=u32(settings.rayCount);
 let extrapolate=settings.slopeCapSetting>0.0;
 var stopped=false;
 var stopIndex=0u;
 for(var i=0u;i<rayCap;i++){
  let running=traced&&!stopped;
  var hit=false;
  // Whether the first ray hit an occluder low enough that every ray of the pixel falls within one
  // pixel of the others (\`rayCountStatement\`): the occluder's surface the hit sample read is |Δ| deep
  // above the receiver, the rays spread over spreadPerDepth·|Δ| + spreadDither pixels.
  var narrow=false;
  if(running){
   let noise4=vsmRayNoise4(pixelPos,vsmView.frameIndex,i,rayCap);
   let rayDir=vsmSunDiskRayDirection(light.direction,light.sourceRadius,noise4.xy);
   let texelShift=(noise4.zw-0.5)*ditherUv;
   var rayState=vsmSunRayBegin(pd,originInMap,rayDir,rayLength,startOffset,uvDepthSlope,texelShift,settings.slopeCapSetting);
   // The projection proves its first ray alone (\`vsmSunRayMisses\`): a later one runs in
   // a half where a lane hit, whose march its lanes wait for, so a proof would save nothing.
   let proven=${waveVotes ? 'i==0u&&vsmSunRayMisses(&rayState,settings.stepsPerRay,noise)' : 'false'};
   if(!proven){
    let march=vsmMarchSun(&rayState,settings.stepsPerRay,noise,extrapolate);
    hit=march.hitFound;
    if(hit&&i==0u){narrow=spreadPerDepth*abs(march.occluderDepth-receiverDepth)+spreadDither<1.0;}
   }
   if(!hit){missCount+=1u;}
  }
${rayCountStatement('settings.voteAfter>0', waveVotes)} }
 if(traced){
  let rayCount=select(rayCap,min(stopIndex+1u,rayCap),stopped);
  result.shadowFactor=f32(missCount)/f32(rayCount);
  result.rayCount=rayCount;
 }
 return result;
}

/** Traces a local light's rays. */
fn vsmTraceLocal(mapId:i32,light:VsmProjectionLight,pixelPos:vec2u,sceneDepth:f32,shiftedPosition:vec3f,startOffset:f32,noise:f32,worldNormal:vec3f,participating:bool,voteSplit:bool)->VsmTraceResult{
 let settings=vsmTraceSetupLocal();
 let h=vsmHandleFromId(u32(mapId));
 let isSpot=light.spotAngles.x>-2.0;
 var result=vsmEmptyTrace();
 result.valid=true;
 result.shadowFactor=0.0;
 let traced=participating;
 let toLight=light.shiftedPosition-shiftedPosition;
 let coneAxis=normalize(toLight);
 let distToLight=length(toLight);
 let coneSin=light.sourceRadius/distToLight;
 var faceMap=h;
 var shiftedInMap=vec3f(0.0);
 var uvDepthSlope=vec2f(0.0);
 var ditherUv=0.0;
 var ditherSlopeCap=0.0;
 var depthBiasCap=0.0;
 var basis:Frame3;
 var frameDepthSlope=vec2f(0.0);
 var stepsPerRay=settings.stepsPerRay;
 var mipLevel=0u;
 if(traced){
  if(!isSpot){faceMap=vsmHandleOffset(faceMap,i32(vsmCubeFace(-toLight)));}
  let pd=vsmProjectionOf(faceMap);
  let toFaceShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmView.originShiftHigh,vsmView.originShiftLow);
  shiftedInMap=shiftedPosition+toFaceShift;
  uvDepthSlope=vsmLocalDepthGradientUv(faceMap,shiftedInMap,worldNormal);
  let pixelSizeHere=vsmReceiverPixelSize(pd,sceneDepth);
  let depthPerDistance=abs(pd.lightViewToClip[3][2]/dot(toLight,toLight));
  ditherUv=(settings.ditherTexels*pd.ditherTexels)*pixelSizeHere;
  ditherSlopeCap=vsm.tracePlaneBiasCapLocal*ditherUv;
  depthBiasCap=vsm.tracePlaneBiasCapLocal*pixelSizeHere*depthPerDistance;
  basis=frameAround(coneAxis);
  let normalInFrame=intoFrame(basis,worldNormal);
  frameDepthSlope=-normalInFrame.xy/normalInFrame.z;
  if(coneSin==0.0){stepsPerRay=0;}
  mipLevel=vsmLocalMipAt(pd,shiftedInMap,sceneDepth);
 }
 var missCount=0u;
 var stepJitter=noise;
 let rayCap=u32(settings.rayCount);
 let extrapolate=settings.slopeCapSetting>0.0;
 var stopped=false;
 var stopIndex=0u;
 for(var i=0u;i<rayCap;i++){
  let running=traced&&!stopped;
  var hit=false;
  var rayStart=vec3f(0.0);
  var rayEnd=vec3f(0.0);
  var depthBias=0.0;
  var startFace=vsmHandleInvalid();
  var endFace=vsmHandleInvalid();
  // A local ray's occluder height is not measured: no lane's rays are known to fall within one
  // pixel (\`rayCountStatement\`).
  let narrow=false;
  if(running){
   let noise4=vsmRayNoise4(pixelPos,vsmView.frameIndex,i,rayCap);
   let diskPoint=vsmSquareToDiskFast(noise4.xy)*coneSin;
   let sinSq=dot(diskPoint,diskPoint);
   let cosTheta=sqrt(1.0-sinSq);
   let dir=outOfFrame(vec3f(diskPoint,cosTheta),basis);
   var ditheredStart=shiftedInMap;
   if(ditherUv>0.0){
    let ditherOffset=(noise4.zw-0.5)*ditherUv;
    let ditherDepth=min(ditherSlopeCap,2.0*max(0.0,dot(frameDepthSlope,ditherOffset)));
    ditheredStart+=outOfFrame(vec3f(ditherOffset,ditherDepth),basis);
   }
   let rayReach=distToLight*vsmLocalRayReach(cosTheta);
   // The 1e-6 is centimetres.
   let start=min(startOffset,rayReach-1e-6*${VSM_UNIT_PER_CM});
   rayStart=ditheredStart+dir*start;
   rayEnd=ditheredStart+dir*rayReach;
   if(depthBiasCap>0.0){depthBias=min(depthBiasCap,vsmLocalTexelPlaneBias(faceMap,rayStart,uvDepthSlope));}
   startFace=vsmHandleOffset(h,i32(vsmCubeFace(rayStart)));
   endFace=vsmHandleOffset(h,i32(vsmCubeFace(rayEnd)));
  }
  // Whether any lane's start face differs from its end face, point lights only.
  var anyCrossing=false;
  if(!isSpot){anyCrossing=${waveVotes ? '!vsmVoteAllTrue(!(running&&startFace.id!=endFace.id),voteSplit)' : 'running&&startFace.id!=endFace.id'};}
  if(running){
   var march:VsmMarchHit;
   if(isSpot){
    var rayState=vsmFaceRayBegin(h,rayStart,rayEnd,settings.slopeCapSetting,depthBias,mipLevel,true);
    march=vsmMarchFace(&rayState,stepsPerRay,stepJitter,extrapolate);
   }else if(anyCrossing){
    var two=vsmCrossFaceRayBegin(startFace,endFace,rayStart,rayEnd,settings.slopeCapSetting,depthBias,mipLevel);
    march=vsmMarchCrossFace(&two,stepsPerRay,stepJitter,extrapolate);
   }else{
    var rayState=vsmFaceRayBegin(endFace,rayStart,rayEnd,settings.slopeCapSetting,depthBias,mipLevel,true);
    march=vsmMarchFace(&rayState,stepsPerRay,stepJitter,extrapolate);
   }
   if(march.hitFound){hit=true;}else{missCount+=1u;}
  }
${rayCountStatement('rayCap>1u&&settings.voteAfter>0', waveVotes)}  if(running&&!stopped){stepJitter=f32(vsmNextRayJitter(bitcast<u32>(stepJitter))>>8u)*5.96046447754e-08;}
  // The top 24 bits of the next word as a fraction: 5.96046447754e-08 is 2^-24, and an f32 holds
  // k · 2^-24 exactly for every k < 2^24.
 }
 if(traced){
  let rayCount=select(rayCap,min(stopIndex+1u,rayCap),stopped);
  result.shadowFactor=f32(missCount)/f32(rayCount);
  result.rayCount=rayCount;
 }
 return result;
}

`,
  )

/** The shadow map sample result (debug members and the occluder distance no consumer
 *  reads dropped): what a trace returns. */
export const VSM_TRACE_RESULT_WGSL = wgslBlock(
  'VSM_TRACE_RESULT_WGSL',
  [],
  `
struct VsmTraceResult{valid:bool,shadowFactor:f32,rayCount:u32,}
fn vsmEmptyTrace()->VsmTraceResult{return VsmTraceResult(false,1.0,0u);}
`,
)
