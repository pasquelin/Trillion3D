/**
 * THE RAY THROUGH A LIGHT'S MAPS (`traceWgsl.ts`), every light's: its line on the map its far end
 * lies in and, where its start lies in another cube face, on that face too; the march over the
 * stored depths along it, from its far end to its start.
 *
 * The march holds the last stored depth it saw and the slope from the one before; where a stored
 * depth lies far behind the ray (past the tolerance), the occluder held is extended along that slope
 * instead, capped by the line's slope cap.
 */
import { VSM_UNIT_PER_CM } from '../constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_PAGE_LOOKUP_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from '../projection/projectionDataWgsl.ts'
import { VSM_TRACE_COMMON_WGSL } from './traceCommonWgsl.ts'
import { vsmTraceMapWgsl } from './traceMapWgsl.ts'
import { vsmLocalTapWgsl } from './traceTapWgsl.ts'
import { type WgslDecl, wgslBlock, wgslFn } from '../../../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../../../math/src/wgsl/projection.ts'
import { NO_INDEX } from '../../../../../../math/src/wgsl/constants.ts'

const CM = `${VSM_UNIT_PER_CM}`

/** The last page the march read, kept for the next read, on the pages of \`pool\`. */
const vsmPageCacheWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmPageCacheWgsl',
    [vsmTraceMapWgsl(pool), VSM_PAGE_LOOKUP_WGSL],
    `
/** A page kept: its map's id \`map\` (\`NO_INDEX\` for none yet), its table page \`key\` at the walked
 *  resolution (\`vsmPageKey\`) and its table words \`page\` (a local map's entry word in
 *  \`page.entry\`). Nothing is kept across a receiver's rays: the march's registers stay its own. */
struct VsmPageCache{map:u32,key:vec2u,page:VsmClipmapPage,}
/** The table page under \`uv\` at the walked resolution: a clipmap level's level-0 page, a local
 *  map's page at mip \`mip\`; a UV of 1 on the last page. */
fn vsmPageKey(clipmap:bool,mip:u32,uv:vec2f)->vec2u{
 return min(vsmClipmapBasePage(uv),vec2u(VSM_LEVEL0_PAGES-1u))>>vec2u(select(mip,0u,clipmap));
}
/** Whether \`c\` keeps page \`key\` of map \`h\`. */
fn vsmPageKept(c:VsmPageCache,h:VsmHandle,key:vec2u)->bool{return h.id==c.map&&all(key==c.key);}
/** Page \`key\` of map \`h\` read from the table (\`vsmPageKey\`). */
fn vsmPageRead(h:VsmHandle,clipmap:bool,mip:u32,key:vec2u)->VsmPageCache{
 var c:VsmPageCache;
 c.map=h.id;
 c.key=key;
 if(clipmap){c.page=vsmClipmapPage(h,key);}
 else{c.page.entry=vsmTableWord(vsmTableEntryOf(h,mip,key));}
 return c;
}
`,
  )

const rayLineAndBiasText = /* wgsl */ `/** A ray's line on map \`h\`: its start (UV, its depth raised by \`bias\`, the receiver-plane bias
 *  of the ray: \`vsmSunDitherBias\`, \`vsmSunTapBias\`, \`vsmLocalPlaneBias\`) and its step to the
 *  far end, and the steepest slope the march extends an occluder with — a
 *  clipmap level's \`traceSlopeCapSun\` in its centimetre arithmetic (·${CM}), a perspective
 *  map's a share of the line's own depth step. It reads the two fields it needs from the map's
 *  record, never a copy of the record: re-reading is cheaper than the registers a copy holds. */
struct VsmRayLine{uvz:vec3f,step:vec3f,slopeCap:f32,}
fn vsmRayLine(h:VsmHandle,clipmap:bool,start:vec3f,end:vec3f,clampStart:bool,bias:f32,uvOffset:vec2f)->VsmRayLine{
 let toUv=vsmProjectionData[h.id].shiftedToMapUv;
 let s4=toUv*vec4f(start,1.0);
 let e4=toUv*vec4f(end,1.0);
 var r:VsmRayLine;
 let a=perspectiveDivide(s4);
 r.step=perspectiveDivide(e4)-a;
 r.uvz=a;
 if(clampStart){r.uvz=vec3f(saturate(a.xy),a.z);}
 r.uvz=vec3f(r.uvz.xy+uvOffset,r.uvz.z+bias);
 r.slopeCap=select(vsm.traceSlopeCapLocal*r.step.z,abs(vsm.traceSlopeCapSun*${CM}*vsmProjectionData[h.id].lightViewToClip[2][2]),clipmap);
 return r;
}
/** The size, in map UV, of a sun ray's start dither on a receiver \`distance\` from the eye: a
 *  texel of the level's resolution at the distance, scaled by the setting and the light's own,
 *  over the level's size in centimetres (the centimetres of the distance: \`VSM_CM_PER_UNIT\`). */
fn vsmSunDitherUv(pd:VsmProjectionData,distance:f32)->f32{
 let scale=vsm.traceDitherSun*pd.ditherTexels;
 if(!(scale>0.0)){return 0.0;}
 return (0.5/f32(VSM_LEVEL0_TEXELS))*scale*distance*VSM_CM_PER_UNIT/exp2(f32(pd.mapLevel)-pd.levelBias);
}
/** The depth the map of \`m\` spans per unit of its light view's distance. */
fn vsmMapDepthScale(m:VsmLightMap)->f32{return abs(vsmProjectionData[m.handle.id].lightViewToClip[2][2]);}
/** The most a sun's receiver-plane lift reaches: \`VSM_TRACE_ONE_TAP_BIAS_CAP\` centimetres of the
 *  depth the map of \`m\` spans. */
fn vsmSunBiasCap(m:VsmLightMap)->f32{
 return VSM_TRACE_ONE_TAP_BIAS_CAP*${CM}*vsmMapDepthScale(m);
}
/** The bias of a sun ray whose start is moved \`offsetUv\` (a step in the map's UV) off its receiver, the start moved
 *  \`startOffset\` along the ray: the plane's lift over that step, its slope held to
 *  \`VSM_TRACE_PLANE_SLOPE_SUN\`, less the depth the start offset gained already (never below 0). */
fn vsmSunDitherBias(m:VsmLightMap,offsetUv:vec2f,startOffset:f32,uvDepthSlope:vec2f)->f32{
 let slope=clamp(uvDepthSlope,vec2f(-VSM_TRACE_PLANE_SLOPE_SUN),vec2f(VSM_TRACE_PLANE_SLOPE_SUN));
 let gained=abs(startOffset)*vsmMapDepthScale(m);
 return max(0.0,vsmPlaneLift(slope,offsetUv)-gained);
}
/** The bias of a sun's one tap, which takes no ray: the plane's lift from the receiver to the
 *  centre of the texel its level maps it on (\`vsmCentreLift\`), held to \`vsmSunBiasCap\`. */
fn vsmSunTapBias(m:VsmLightMap,uvDepthSlope:vec2f)->f32{
 let t=vsmClipmapTexel(m.level,m.page,m.levelPoint.xy);
 if(!t.valid){return 0.0;}
 return vsmCentreLift(t.mapTexelXY,t.mapTexelPos,vsmTexelsAtLevel(0u),uvDepthSlope,vsmSunBiasCap(m));
}`

/** The page the last sample of the last ray read (the views of the virtual shadow maps, `visualize`): its map, mip, virtual texel and pool texel, the map NO_INDEX before a valid sample. */
const RAY_SEEN_DECL = /* wgsl */ `
struct VsmSeen{map:u32,mip:u32,virtualTexel:vec2u,poolTexel:vec2u,}
var<private> vsmSeen:VsmSeen;`

const rayBeginText = (visualize: boolean) => /* wgsl */ `
/** The largest plane bias of a local ray (\`vsmLocalPlaneBias\`) on a receiver of texel \`texel\` (a
 *  world width) at a squared distance \`distSq\` from the light: \`tracePlaneBiasCap\` of its texels,
 *  in the depth they span there. */
fn vsmLocalBiasCap(m:VsmLightMap,texel:f32,distSq:f32)->f32{
 return vsm.tracePlaneBiasCap*texel*vsmDepthPerDistance(vsmProjectionOf(m.handle),distSq);
}
/** The bias of a local ray starting at \`rayStart\`: the plane's lift from there to the centre of the
 *  texel it falls in on the receiver's map, at the page's resolution, held to \`cap\`. */
fn vsmLocalPlaneBias(m:VsmLightMap,rayStart:vec3f,uvDepthSlope:vec2f,cap:f32)->f32{
 let uv=saturate(perspectiveDivide(vsmProjectionData[m.handle.id].shiftedToMapUv*vec4f(rayStart,1.0)).xy);
 let key=vsmPageKey(false,m.mip,uv);
 let page=vsmLocalPageFrom(vsmTableWord(vsmTableEntryOf(m.handle,m.mip,key)),uv,m.mip);
 if(!page.valid){return 0.0;}
 return vsmCentreLift(page.mapTexelXY,page.mapTexelPos,vsmTexelsAtLevel(page.coarserLevels),uvDepthSlope,cap);
}
/** A ray: its far map's line and, where its start lies in another cube face (\`crosses\`), the near
 *  face's, which the march takes over where the far face holds no more sample (\`inFar\` false). A
 *  ray on one map clamps its start into the map's square. The page its last sample read, kept for
 *  the next (\`vsmRayTexel\`, \`VsmPageCache\`). */
struct VsmRay{far:VsmHandle,near:VsmHandle,clipmap:bool,mip:u32,crosses:bool,inFar:bool,farLine:VsmRayLine,nearLine:VsmRayLine,pages:VsmPageCache,}
/** The ray of light map \`m\` (\`vsmLightMapAt\`): its far map's line and, where it crosses, its
 *  near face's. */
fn vsmRayBegin(light:VsmProjectionLight,m:VsmLightMap,start:vec3f,end:vec3f,bias:f32,uvOffset:vec2f)->VsmRay{
 var r:VsmRay;
 r.clipmap=m.clipmap;
 r.mip=m.mip;
 r.far=m.handle;
 r.near=m.handle;
 r.pages.map=NO_INDEX;${visualize ? '\n vsmSeen.map=NO_INDEX;' : ''}
 if(!m.clipmap&&light.kind!=LIGHT_KIND_SPOT){
  let base=vsmHandleFromId(u32(light.mapId));
  r.far=vsmHandleOffset(base,i32(vsmCubeFace(end)));
  r.near=vsmHandleOffset(base,i32(vsmCubeFace(start)));
 }
 r.crosses=r.far.id!=r.near.id;
 r.inFar=true;
 r.farLine=vsmRayLine(r.far,r.clipmap,start,end,!r.crosses,bias,uvOffset);
 r.nearLine=r.farLine;
 if(r.crosses){r.nearLine=vsmRayLine(r.near,r.clipmap,start,end,false,bias,uvOffset);}
 return r;
}`

const rayTexelText = (visualize: boolean) => /* wgsl */ `
/** The texel a sample at \`uv\` of the ray's map \`h\` reads (\`VsmClipmapTexel\`, a local map's with
 *  its depth taken as it is). The page table is read where the sample's page is not the last one
 *  the ray read (\`vsmPageKept\`). */
fn vsmRayTexel(ray:ptr<function,VsmRay>,h:VsmHandle,uv:vec2f)->VsmClipmapTexel{
 var r:VsmClipmapTexel;
 if(any(uv!=saturate(uv))){return r;}
 let clipmap=(*ray).clipmap;
 let mip=(*ray).mip;
 let key=vsmPageKey(clipmap,mip,uv);
 if(!vsmPageKept((*ray).pages,h,key)){(*ray).pages=vsmPageRead(h,clipmap,mip,key);}
 if(clipmap){${
   visualize
     ? `
  let t=vsmClipmapTexel(h,(*ray).pages.page,uv);
  if(t.valid){vsmSeen=VsmSeen(t.levelHandle.id,u32(vsmProjectionData[t.levelHandle.id].mapLevel),t.mapTexelXY,t.poolTexel);}
  return t;`
     : `
  return vsmClipmapTexel(h,(*ray).pages.page,uv);`
 }
 }
 let page=vsmLocalPageFrom((*ray).pages.page.entry,uv,mip);${
   visualize
     ? `
 if(page.valid){vsmSeen=VsmSeen(h.id,mip,page.mapTexelXY,page.poolTexel);}`
     : ''
 }
 r.valid=page.valid;
 r.poolTexel=page.poolTexel;
 r.depthLevelInverse=1.0;
 return r;
}
/** One sample of the march: whether a texel holds it, the depth stored there and the ray's own. */
struct VsmMarchStep{valid:bool,storedDepth:f32,marchRayDepth:f32,slopeCap:f32,restartSlope:bool,}
fn vsmRaySampleOn(ray:ptr<function,VsmRay>,h:VsmHandle,line:VsmRayLine,rayTime:f32)->VsmMarchStep{
 let uvz=line.uvz+line.step*rayTime;
 var s=VsmMarchStep(false,0.0,uvz.z,line.slopeCap,false);
 let t=vsmRayTexel(ray,h,uvz.xy);
 if(t.valid){s.valid=true;s.storedDepth=vsmClipmapTexelDepth(t,vsmPoolDepth(t.poolTexel));}
 return s;
}
/** The ray's sample at \`rayTime\`: on the far map, then on the near face once the far face holds
 *  none — the slope held restarting there. */
fn vsmRayStep(ray:ptr<function,VsmRay>,rayTime:f32)->VsmMarchStep{
 if((*ray).inFar){
  let s=vsmRaySampleOn(ray,(*ray).far,(*ray).farLine,rayTime);
  if(s.valid||!(*ray).crosses){return s;}
  (*ray).inFar=false;
  var n=vsmRaySampleOn(ray,(*ray).near,(*ray).nearLine,rayTime);
  n.restartSlope=true;
  return n;
 }
 return vsmRaySampleOn(ray,(*ray).near,(*ray).nearLine,rayTime);
}`

const rayMarchText = /* wgsl */ `
/** The march: from the far end to the start, each sample's stored depth against the ray's; whether
 *  it hit, and, where it did, the depth it hit at (\`hitDepth\`: the stored depth of the sample that
 *  hit, or the depth the march held across a gap). */
fn vsmMarch(ray:ptr<function,VsmRay>,stepCount:i32,stepJitter:f32,hitDepth:ptr<function,f32>)->bool{
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
    if(storedDepth>marchRayDepth){*hitDepth=storedDepth;return true;}
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
    if(abs(depthGap+halfTolerance)<halfTolerance){*hitDepth=comparedDepth;return true;}
   }
   prevRayDepth=marchRayDepth;
  }
 }
 return false;
}`

/** How far the receiver at clip depth \`receiverDepth\` lies from an occluder at \`hitDepth\` on an
 *  orthographic map of clip matrix \`m\`: the difference of the two view depths, never under a
 *  millionth of a centimetre. */
export const VSM_ORTHO_OCCLUDER_WGSL = wgslFn(
  'vsmOrthoOccluderDistance',
  [],
  `fn vsmOrthoOccluderDistance(m:mat4x4f,hitDepth:f32,receiverDepth:f32)->f32{
 let occluderViewZ=(hitDepth-m[3][2])/m[2][2];
 let receiverViewZ=(receiverDepth-m[3][2])/m[2][2];
 return max(1e-6*${VSM_UNIT_PER_CM},receiverViewZ-occluderViewZ);
}`,
)

const rayOccluderText = /* wgsl */ `
/** How far the receiver lies from what stopped a ray that hit at \`hitDepth\`, on the map the ray's
 *  last sample was on: a sun's ortho map by \`vsmOrthoOccluderDistance\`, a local light's by
 *  \`vsmLocalOccluderDistance\`, from the receiver's distance \`receiverDistance\` to the light. */
fn vsmRayOccluderDistance(ray:ptr<function,VsmRay>,hitDepth:f32,receiverDistance:f32)->f32{
 var h=(*ray).near;
 var line=(*ray).nearLine;
 if((*ray).inFar){h=(*ray).far;line=(*ray).farLine;}
 let m=vsmProjectionData[h.id].lightViewToClip;
 if((*ray).clipmap){return vsmOrthoOccluderDistance(m,hitDepth,line.uvz.z);}
 return vsmLocalOccluderDistance(m,hitDepth,line.uvz.z,receiverDistance);
}`

/** The ray and its march, sampling the pages of `pool`. With `visualize`, the page of the last valid sample of the last ray is kept (`vsmSeen`) for the views of the virtual shadow maps. */
export const vsmTraceRayWgsl = (pool: WgslDecl, visualize = false) =>
  wgslBlock(
    visualize ? 'vsmTraceRayWgsl(visualize)' : 'vsmTraceRayWgsl',
    [
      VSM_TRACE_COMMON_WGSL,
      vsmTraceMapWgsl(pool),
      vsmLocalTapWgsl(pool),
      vsmPageCacheWgsl(pool),
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      perspectiveDivide,
      NO_INDEX,
      VSM_ORTHO_OCCLUDER_WGSL,
    ],
    `
${visualize ? RAY_SEEN_DECL : ''}${rayLineAndBiasText}${rayBeginText(visualize)}${rayTexelText(visualize)}${rayMarchText}${rayOccluderText}
`,
  )
