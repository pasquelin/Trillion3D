/**
 * THE RAY THROUGH A LIGHT'S MAPS (`traceWgsl.ts`), every light's: its line on the map its far end
 * lies in and, where its start lies in another cube face, on that face too; the march over the
 * stored depths along it, from its far end to its start; and the proof that it misses, read from the
 * pages' tile depths alone.
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
import { type WgslDecl, wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../../../math/src/wgsl/projection.ts'
import { NO_INDEX } from '../../../../../../math/src/wgsl/constants.ts'

const CM = `${VSM_UNIT_PER_CM}`

/** The last page a walk over a map read, kept for the next read: what the ray's march and the
 *  panes' walk each look a page up through (\`vsmTraceRayWgsl\`, \`transmissionRayWgsl.ts\`), on the
 *  pages of \`pool\`. */
export const vsmPageCacheWgsl = (pool: WgslDecl) =>
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

/** The ray and its march, sampling the pages of `pool`. */
export const vsmTraceRayWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmTraceRayWgsl',
    [
      VSM_TRACE_COMMON_WGSL,
      vsmTraceMapWgsl(pool),
      vsmPageCacheWgsl(pool),
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      perspectiveDivide,
      NO_INDEX,
    ],
    `
/** A ray's line on map \`h\`: its start (UV, depth biased by the receiver's plane: \`planeBias\` less the
 *  depth the start gained over the receiver's own point \`origin\`, never below 0) and its step to the
 *  far end, and the steepest slope the march extends an occluder with — a
 *  clipmap level's \`VSM_TRACE_SLOPE_CAP_SUN\` in its centimetre arithmetic (·${CM}), a perspective
 *  map's a share of the line's own depth step. It reads the two fields it needs from the map's
 *  record, never a copy of the record: re-reading is cheaper than the registers a copy holds. */
struct VsmRayLine{uvz:vec3f,step:vec3f,slopeCap:f32,}
fn vsmRayLine(h:VsmHandle,clipmap:bool,origin:vec3f,start:vec3f,end:vec3f,clampStart:bool,planeBias:f32)->VsmRayLine{
 let toUv=vsmProjectionData[h.id].shiftedToMapUv;
 let s4=toUv*vec4f(start,1.0);
 let e4=toUv*vec4f(end,1.0);
 var r:VsmRayLine;
 let a=perspectiveDivide(s4);
 r.step=perspectiveDivide(e4)-a;
 r.uvz=a;
 if(clampStart){r.uvz=vec3f(saturate(a.xy),a.z);}
 let gained=abs(a.z-perspectiveDivide(toUv*vec4f(origin,1.0)).z);
 r.uvz.z+=max(0.0,planeBias-gained);
 r.slopeCap=select(VSM_TRACE_SLOPE_CAP_LOCAL*r.step.z,abs(VSM_TRACE_SLOPE_CAP_SUN*${CM}*vsmProjectionData[h.id].lightViewToClip[2][2]),clipmap);
 return r;
}
/** A ray: its far map's line and, where its start lies in another cube face (\`crosses\`), the near
 *  face's, which the march takes over where the far face holds no more sample (\`inFar\` false). A
 *  ray on one map clamps its start into the map's square. The page its last sample read, kept for
 *  the next (\`vsmRayTexel\`, \`VsmPageCache\`). */
struct VsmRay{far:VsmHandle,near:VsmHandle,clipmap:bool,mip:u32,crosses:bool,inFar:bool,farLine:VsmRayLine,nearLine:VsmRayLine,pages:VsmPageCache,}
/** The ray of light map \`m\` (\`vsmLightMapAt\`): its far map's line and, where it crosses, its
 *  near face's. */
fn vsmRayBegin(light:VsmProjectionLight,m:VsmLightMap,origin:vec3f,start:vec3f,end:vec3f,planeBias:f32)->VsmRay{
 var r:VsmRay;
 r.clipmap=m.clipmap;
 r.mip=m.mip;
 r.far=m.handle;
 r.near=m.handle;
 r.pages.map=NO_INDEX;
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
/** The texel a sample at \`uv\` of the ray's map \`h\` reads (\`VsmMapTexel\`). The page table is
 *  read where the sample's page is not the last one the ray read (\`vsmPageKept\`). */
fn vsmRayTexel(ray:ptr<function,VsmRay>,h:VsmHandle,uv:vec2f)->VsmMapTexel{
 var r:VsmMapTexel;
 if(any(uv!=saturate(uv))){return r;}
 let clipmap=(*ray).clipmap;
 let mip=(*ray).mip;
 let key=vsmPageKey(clipmap,mip,uv);
 if(!vsmPageKept((*ray).pages,h,key)){(*ray).pages=vsmPageRead(h,clipmap,mip,key);}
 if(clipmap){
  let t=vsmClipmapTexel(h,(*ray).pages.page,uv);
  r.valid=t.valid;
  r.poolTexel=t.poolTexel;
  r.depthBias=t.depthLevelBias;
  r.depthInverse=t.depthLevelInverse;
  return r;
 }
 let page=vsmLocalPageFrom((*ray).pages.page.entry,uv,mip);
 r.valid=page.valid;
 r.poolTexel=page.poolTexel;
 r.depthInverse=1.0;
 return r;
}
/** One sample of the march: whether a texel holds it, the depth stored there and the ray's own. */
struct VsmMarchStep{valid:bool,storedDepth:f32,marchRayDepth:f32,slopeCap:f32,restartSlope:bool,}
fn vsmRaySampleOn(ray:ptr<function,VsmRay>,h:VsmHandle,line:VsmRayLine,rayTime:f32)->VsmMarchStep{
 let uvz=line.uvz+line.step*rayTime;
 var s=VsmMarchStep(false,0.0,uvz.z,line.slopeCap,false);
 let t=vsmRayTexel(ray,h,uvz.xy);
 if(t.valid){s.valid=true;s.storedDepth=vsmMapTexelDepth(t,vsmPoolDepth(t.poolTexel));}
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
}
/** The march: from the far end to the start, each sample's stored depth against the ray's; whether
 *  it hit. */
fn vsmMarch(ray:ptr<function,VsmRay>,stepCount:i32,stepJitter:f32)->bool{
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
    if(storedDepth>marchRayDepth){return true;}
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
    if(abs(depthGap+halfTolerance)<halfTolerance){return true;}
   }
   prevRayDepth=marchRayDepth;
  }
 }
 return false;
}
`,
  )

/**
 * WHY A PROOF BEFORE THE MARCH: a pool held in a texture array is read through the texture cache
 * and can be marched directly; WebGPU has no texture atomics, so this pool is a storage buffer the raster's atomicMax writes, read with no texture
 * cache. A lit pixel's first ray would read the whole pool's scattered words; this proof reads the
 * tile depths instead (a 256th of the pool), and the march runs only where it fails.
 *
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
 * row inside it; the page words it reads stay in the ray (\`vsmRayTexel\`), where the march, if it
 * fails, reads them again. A ray across two cube faces is not proved: which face a sample reads follows the
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
  let t=vsmRayTexel(ray,(*ray).far,uvz.xy);
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
