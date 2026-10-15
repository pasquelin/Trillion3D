/**
 * THE RAY THROUGH A LIGHT'S MAPS (`traceWgsl.ts`), every light's: its line on the map its far end
 * lies in and, where its start lies in another cube face, on that face too; the march over the
 * stored depths along it, from its far end to its start; the proof that it misses, read from the
 * pages' tile depths alone; and the distance from the receiver at which it hit.
 *
 * The march holds the last stored depth it saw and the slope from the one before; where a stored
 * depth lies far behind the ray (past the tolerance), the occluder held is extended along that slope
 * instead, capped by the line's slope cap.
 */
import { VSM_UNIT_PER_CM } from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from './projectionDataWgsl.ts'
import { VSM_TRACE_COMMON_WGSL } from './traceCommonWgsl.ts'
import { vsmTraceMapWgsl } from './traceMapWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../math/src/wgsl/projection.ts'

const CM = `${VSM_UNIT_PER_CM}`

/** The ray and its march, sampling the pages of `pool`. */
export const vsmTraceRayWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmTraceRayWgsl',
    [
      VSM_TRACE_COMMON_WGSL,
      vsmTraceMapWgsl(pool),
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      perspectiveDivide,
    ],
    `
/** A ray's line on one map: its start (UV, depth biased by the receiver's plane: \`planeBias\` less the
 *  depth the start gained over the receiver's own point \`origin\`, never below 0) and its step to the
 *  far end, the clip w at both ends, and the steepest slope the march extends an occluder with — a
 *  clipmap level's \`VSM_TRACE_SLOPE_CAP_SUN\` in its centimetre arithmetic (·${CM}), a perspective
 *  map's a share of the line's own depth step. */
struct VsmRayLine{uvz:vec3f,step:vec3f,w:vec2f,slopeCap:f32,}
fn vsmRayLine(h:VsmHandle,clipmap:bool,origin:vec3f,start:vec3f,end:vec3f,clampStart:bool,planeBias:f32)->VsmRayLine{
 let pd=vsmProjectionOf(h);
 let s4=pd.shiftedToMapUv*vec4f(start,1.0);
 let e4=pd.shiftedToMapUv*vec4f(end,1.0);
 var r:VsmRayLine;
 let a=perspectiveDivide(s4);
 r.step=perspectiveDivide(e4)-a;
 r.uvz=a;
 if(clampStart){r.uvz=vec3f(saturate(a.xy),a.z);}
 let gained=abs(a.z-perspectiveDivide(pd.shiftedToMapUv*vec4f(origin,1.0)).z);
 r.uvz.z+=max(0.0,planeBias-gained);
 r.w=vec2f(s4.w,e4.w);
 r.slopeCap=select(VSM_TRACE_SLOPE_CAP_LOCAL*r.step.z,abs(VSM_TRACE_SLOPE_CAP_SUN*${CM}*pd.lightViewToClip[2][2]),clipmap);
 return r;
}
/** A ray: its far map's line and, where its start lies in another cube face (\`crosses\`), the near
 *  face's, which the march takes over where the far face holds no more sample (\`inFar\` false). A
 *  ray on one map clamps its start into the map's square. */
struct VsmRay{far:VsmHandle,near:VsmHandle,clipmap:bool,mip:u32,crosses:bool,inFar:bool,farLine:VsmRayLine,nearLine:VsmRayLine,}
fn vsmRayBegin(light:VsmProjectionLight,m:VsmLightMap,origin:vec3f,start:vec3f,end:vec3f,planeBias:f32)->VsmRay{
 var r:VsmRay;
 r.clipmap=m.clipmap;
 r.mip=m.mip;
 r.far=m.handle;
 r.near=m.handle;
 if(!m.clipmap&&light.kind!=LIGHT_KIND_SPOT){
  let base=vsmHandleFromId(u32(light.mapId));
  r.far=vsmHandleOffset(base,i32(vsmCubeFace(end)));
  r.near=vsmHandleOffset(base,i32(vsmCubeFace(start)));
 }
 r.crosses=r.far.id!=r.near.id;
 r.inFar=true;
 r.farLine=vsmRayLine(r.far,r.clipmap,origin,start,end,!r.crosses,planeBias);
 r.nearLine=r.farLine;
 if(r.crosses){r.nearLine=vsmRayLine(r.near,r.clipmap,origin,start,end,false,planeBias);}
 return r;
}
/** One sample of the march: whether a texel holds it, the depth stored there and the ray's own. */
struct VsmMarchStep{valid:bool,storedDepth:f32,marchRayDepth:f32,slopeCap:f32,restartSlope:bool,}
fn vsmRaySampleOn(h:VsmHandle,clipmap:bool,mip:u32,line:VsmRayLine,rayTime:f32)->VsmMarchStep{
 let uvz=line.uvz+line.step*rayTime;
 var s=VsmMarchStep(false,0.0,uvz.z,line.slopeCap,false);
 let t=vsmMapTexel(h,clipmap,mip,uvz.xy);
 if(t.valid){s.valid=true;s.storedDepth=vsmMapTexelDepth(t,vsmPoolDepth(t.poolTexel));}
 return s;
}
/** The ray's sample at \`rayTime\`: on the far map, then on the near face once the far face holds
 *  none — the slope held restarting there. */
fn vsmRayStep(ray:ptr<function,VsmRay>,rayTime:f32)->VsmMarchStep{
 if((*ray).inFar){
  let s=vsmRaySampleOn((*ray).far,(*ray).clipmap,(*ray).mip,(*ray).farLine,rayTime);
  if(s.valid||!(*ray).crosses){return s;}
  (*ray).inFar=false;
  var n=vsmRaySampleOn((*ray).near,(*ray).clipmap,(*ray).mip,(*ray).nearLine,rayTime);
  n.restartSlope=true;
  return n;
 }
 return vsmRaySampleOn((*ray).near,(*ray).clipmap,(*ray).mip,(*ray).nearLine,rayTime);
}
/** The march: from the far end to the start, each sample's stored depth against the ray's. */
fn vsmMarch(ray:ptr<function,VsmRay>,stepCount:i32,stepJitter:f32)->VsmMarchHit{
 // Declared: a value far from every stored depth (device depths lie in [0, 1]): nothing held yet.
 let noHistory=-10000.0;
 var heldDepth=noHistory;
 var heldTime=-1.0;
 var heldSlope=0.0;
 let time=vsmMarchTimeLine(stepCount,stepJitter);
 var prevRayDepth=-1.0;
 for(var i=0;i<=stepCount;i++){
  let rayTime=vsmMarchTime(i,stepCount,time);
  let s=vsmRayStep(ray,rayTime);
  let marchRayDepth=s.marchRayDepth;
  if(s.restartSlope){heldSlope=s.slopeCap;}
  if(s.valid){
   let storedDepth=s.storedDepth;
   if(heldDepth==noHistory){
    heldDepth=storedDepth;
    heldTime=rayTime;
    if(storedDepth>marchRayDepth){return VsmMarchHit(true,rayTime);}
   }else{
    let rayDepthStep=marchRayDepth-prevRayDepth;
    // Declared: the comparison's tolerance, 5 % over the ray's depth step between two samples.
    let depthTolerance=abs(rayDepthStep)*1.05;
    let farBehind=(storedDepth-marchRayDepth)>depthTolerance;
    var comparedDepth=storedDepth;
    let sinceHeld=rayTime-heldTime;
    if(farBehind){comparedDepth=heldSlope*sinceHeld+heldDepth;}
    else if(storedDepth!=heldDepth){
     let slopeLimit=s.slopeCap;
     // clamp as min(max(x,lo),hi): defined also when lo > hi, which WGSL's clamp is not.
     heldSlope=min(max((storedDepth-heldDepth)/sinceHeld,-slopeLimit),slopeLimit);
     heldDepth=storedDepth;
     heldTime=rayTime;
    }
    let depthGap=marchRayDepth-comparedDepth;
    let halfTolerance=0.5*depthTolerance;
    if(abs(depthGap+halfTolerance)<halfTolerance){return VsmMarchHit(true,rayTime);}
   }
   prevRayDepth=marchRayDepth;
  }
 }
 return VsmMarchHit(false,0.0);
}
/** The distance from the receiver along the ray to its sample at \`rayTime\`, \`t0\` the start's and
 *  \`reach\` the far end's: the line's time taken back to the world's (perspective-correct by the
 *  clip w at both ends, the same time on an orthographic map). */
fn vsmRayDistance(ray:ptr<function,VsmRay>,rayTime:f32,t0:f32,reach:f32)->f32{
 let w=select((*ray).nearLine.w,(*ray).farLine.w,(*ray).inFar);
 return t0+(reach-t0)*(rayTime*w.x/mix(w.y,w.x,rayTime));
}
`,
  )

/**
 * Whether a ray on one map provably misses, from its samples' tiles alone (`tileDepths`): every
 * valid sample it would take is at or above (no closer to the light than) the closest depth of the
 * tile of 8×8 pool texels its texel is in. A march (`vsmMarch`) whose every valid sample has
 * storedDepth ≤ marchRayDepth returns no hit: its first valid sample hits only for storedDepth >
 * marchRayDepth; a later one is never behind (storedDepth − marchRayDepth ≤ 0 ≤ its tolerance), so it
 * compares its own depth, and hits only for marchRayDepth < storedDepth; f32 keeps both signs
 * (rounding is monotonic). A tile's word is the greatest of its texels' words whose float is not
 * below 0 (a texel below 0, or NaN, never hits: any bound holds it), so its float bounds each
 * texel's, and taken to the map's depth as a texel's raw depth is (`vsmMapTexelDepth`) it bounds each
 * sample's. The samples are the march's own: the same times, UVs, pages and texels, nearest the
 * receiver first, where an occluder ends the test soonest; a tile is read once for the samples in a
 * row inside it. A ray across two cube faces is not proved: which face a sample reads follows the
 * march's own history. Not proven: that a GPU compiler evaluates those helpers to the same bits at
 * both call sites (it may fuse a multiply-add at one alone).
 */
export const vsmRayMissesWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmRayMissesWgsl',
    [VSM_TRACE_COMMON_WGSL, vsmTraceRayWgsl(pool), VSM_PAGE_ADDRESS_WGSL],
    `
fn vsmRayMisses(ray:ptr<function,VsmRay>,stepCount:i32,stepJitter:f32)->bool{
 if((*ray).crosses){return false;}
 let time=vsmMarchTimeLine(stepCount,stepJitter);
 let line=(*ray).farLine;
 var tile=0xFFFFFFFFu;
 var raw=0.0;
 for(var i=stepCount;i>=0;i--){
  let uvz=line.uvz+line.step*vsmMarchTime(i,stepCount,time);
  let t=vsmMapTexel((*ray).far,(*ray).clipmap,(*ray).mip,uvz.xy);
  if(t.valid){
   let k=vsmTileDepthIndex(t.poolTexel);
   if(k!=tile){tile=k;raw=bitcast<f32>(vsmTileDepthsLoad(k));}
   if(!(vsmMapTexelDepth(t,raw)<=uvz.z)){return false;}
  }
 }
 return true;
}
`,
  )
