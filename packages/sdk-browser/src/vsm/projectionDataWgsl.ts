/**
 * The projection shader data (the host twin is in `projectionData.ts`) and the projection-side
 * page sampling helpers.
 *
 * `VsmProjectionRecord` is the exact memory record (`VSM_PROJECTION_RECORD_BYTES`) — offsets in
 * `projectionData.ts`. Matrices are the engine's column-major ones, WGSL's mat4x4f: `M * v`
 * transforms a column vector and `M[i][j]` is column i, row j.
 *
 * Strings:
 * - `VSM_PROJECTION_DATA_WGSL`: the raw and decoded structs and the decode (no bindings), and the
 *   helpers every pass shares, each the one text of its maths: the clipmap level and distance, the
 *   cube face, a view's depth from device depth, a pixel's world size and a local map's pixel
 *   footprint, a sun's back face.
 * - `VSM_PROJECTION_DATA_READ_WGSL`: `vsmProjectionOf(handle)`; needs the
 *   `vsmProjectionData` binding.
 * - `VSM_PROJECTION_SAMPLE_WGSL`: the page sampling; needs everything above plus the page lookup
 *   (`VSM_PAGE_LOOKUP_WGSL`) and `vsmPoolLoad(texel, slice)` from the binding builder.
 */
import { VSM_UNIT_PER_CM } from './constants.ts';

const CM = `${VSM_UNIT_PER_CM}`;

export const VSM_PROJECTION_DATA_WGSL = /* wgsl */ `
struct VsmProjectionRecord{
 lightKind:u32,
 emitterSize:f32,
 finestMip:u32,
 mapLevel:i32,
 lightViewToClip:mat4x4f,
 lightDirection:vec3f,
 levelsLeft:i32,
 planesToMapUv:mat4x4f,
 shiftedToMapUv:mat4x4f,
 originShiftHigh:vec3f,
 flags:u32,
 originShiftLow:vec3f,
 levelBias:f32,
 clipmapOrigin:vec3f,
 ditherTexels:f32,
 cornerSteps:vec2i,
 lightRange:f32,
}
struct VsmProjectionData{
 lightKind:u32,
 emitterSize:f32,
 finestMip:u32,
 mapLevel:i32,
 lightViewToClip:mat4x4f,
 lightDirection:vec3f,
 levelsLeft:i32,
 planesToMapUv:mat4x4f,
 shiftedToMapUv:mat4x4f,
 originShiftHigh:vec3f,
 flags:u32,
 originShiftLow:vec3f,
 levelBias:f32,
 clipmapOrigin:vec3f,
 ditherTexels:f32,
 cornerSteps:vec2i,
 lightRange:f32,
 handle:VsmHandle,
 uncached:bool,
 lightUnseen:bool,
 coarseLevel:bool,
 useCover:bool,
 coarseDynamicCached:bool,
}
/** Decodes the raw record into the projection data struct. */
fn vsmUnpackProjection(raw:VsmProjectionRecord,h:VsmHandle)->VsmProjectionData{
 var r:VsmProjectionData;
 r.handle=h;
 r.lightKind=raw.lightKind;
 r.emitterSize=raw.emitterSize;
 r.finestMip=raw.finestMip;
 r.mapLevel=raw.mapLevel;
 r.lightViewToClip=raw.lightViewToClip;
 r.lightDirection=raw.lightDirection;
 r.levelsLeft=raw.levelsLeft;
 r.planesToMapUv=raw.planesToMapUv;
 r.shiftedToMapUv=raw.shiftedToMapUv;
 r.originShiftHigh=raw.originShiftHigh;
 r.flags=raw.flags;
 r.originShiftLow=raw.originShiftLow;
 r.levelBias=raw.levelBias;
 r.clipmapOrigin=raw.clipmapOrigin;
 r.ditherTexels=raw.ditherTexels;
 r.cornerSteps=raw.cornerSteps;
 r.lightRange=raw.lightRange;
 r.uncached=(r.flags&VSM_MAP_UNCACHED)!=0u;
 r.lightUnseen=(r.flags&VSM_MAP_UNSEEN)!=0u;
 r.coarseLevel=(r.flags&VSM_MAP_COARSE)!=0u;
 r.useCover=(r.flags&VSM_MAP_COVERAGE)!=0u;
 r.coarseDynamicCached=(r.flags&VSM_MAP_COARSE_KEEPS_DYNAMIC)!=0u;
 return r;
}
/** The difference of two high/low pairs, demoted to f32: the high parts subtract, the low parts are added. */
fn vsmSubtractHighLow(aHigh:vec3f,aLow:vec3f,bHigh:vec3f,bLow:vec3f)->vec3f{
 let h=aHigh-bHigh;
 let l=aLow-bLow;
 return h+l;
}
/** The clipmap level of a distance (squared, in world units², converted to cm²). */
fn vsmLevelOfDistanceSq(distSqToOrigin:f32)->f32{
 return log2(distSqToOrigin*(VSM_CM_PER_UNIT*VSM_CM_PER_UNIT))*0.5;
}
/** viewOriginShift* is the view's origin shift (high/low). */
fn vsmDistanceSqToOrigin(base:VsmProjectionData,shiftedPosition:vec3f,viewOriginShiftHigh:vec3f,viewOriginShiftLow:vec3f)->f32{
 let toMapShift=vsmSubtractHighLow(base.originShiftHigh,base.originShiftLow,viewOriginShiftHigh,viewOriginShiftLow);
 let shiftedOrigin=-base.clipmapOrigin+toMapShift;
 let d=shiftedPosition+shiftedOrigin;
 return dot(d,d);
}
/** The cube face: the largest axis. */
fn vsmCubeFace(d:vec3f)->u32{
 if(abs(d.x)>=abs(d.y)&&abs(d.x)>=abs(d.z)){return select(1u,0u,d.x>0.0);}
 else if(abs(d.y)>abs(d.z)){return select(3u,2u,d.y>0.0);}
 return select(5u,4u,d.z>0.0);
}
/** The view depth of a device depth (reverse-Z), from a view's transform words \`t\`. */
fn vsmViewDepthOfDeviceZ(deviceZ:f32,t:vec4f)->f32{
 return deviceZ*t.x+t.y+1.0/(deviceZ*t.z-t.w);
}
/** The world size of a pixel at a view depth, the narrower of its two spans, for a view of
 *  \`viewToClip\` (looking down +z) drawn at \`viewSize\` pixels. */
fn vsmPixelWorldSize(sceneDepth:f32,viewToClip:mat4x4f,viewSize:vec2f)->f32{
 let pixelSpan=1.0/(viewSize*vec2f(viewToClip[0][0],viewToClip[1][1]));
 let pixelSpanMin=min(pixelSpan.x,pixelSpan.y);
 let depthToSpan=sceneDepth*viewToClip[2][3]+viewToClip[3][3];
 return depthToSpan*pixelSpanMin;
}
/** The footprint of a pixel in a local light's map, for a view of \`viewToClip\` (looking down
 *  +z) drawn at \`viewSize\` pixels. */
fn vsmLocalPixelFootprint(pd:VsmProjectionData,pointInMap:vec3f,sceneDepth:f32,viewToClip:mat4x4f,viewSize:vec2f)->f32{
 let pixelWorld=vsmPixelWorldSize(sceneDepth,viewToClip,viewSize);
 let mapUvz=pd.shiftedToMapUv*vec4f(pointInMap,1.0);
 let pixelClip4=pd.lightViewToClip*vec4f(pixelWorld,0.0,mapUvz.w,1.0);
 let pixelClip=abs(pixelClip4.x/pixelClip4.w);
 return pixelClip*f32(2u*VSM_LEVEL0_TEXELS);
}
/** Whether the normal faces away from a local light \`toLight\` away (the vector, not its direction):
 *  further than the sine of the light's half angle as the point sees it. The "+ 1 cm²" (·${CM}²)
 *  keeps the nearInverse finite at the light's centre. */
fn vsmFacesAwayFromLocal(toLight:vec3f,normal:vec3f,emitterSize:f32)->bool{
 let rangeSq=dot(toLight,toLight);
 let nearInverse=1.0/(rangeSq+${CM}*${CM});
 let invDist=inverseSqrt(rangeSq);
 let emitterSinSq=saturate(emitterSize*emitterSize*nearInverse);
 let emitterSin=sqrt(emitterSinSq);
 return dot(normal,toLight*invDist)< -emitterSin;
}
/** Whether the normal faces away from a sun of this angular radius. */
fn vsmFacesAwayFromSun(normal:vec3f,lightDirection:vec3f,emitterSize:f32)->bool{
 // Declared: the least margin past the sun's terminator, sin α = 0.1 (5.7°), before a point counts
 // as facing away: a normal smoothed across the terminator is not culled.
 let terminatorSin=0.1;
 let emitterSin=max(abs(emitterSize),terminatorSin);
 return dot(normal,lightDirection)< -emitterSin;
}
`;

/** Reads a map's projection data. Needs the `vsmProjectionData` binding. */
export const VSM_PROJECTION_DATA_READ_WGSL = /* wgsl */ `
fn vsmProjectionOf(h:VsmHandle)->VsmProjectionData{return vsmUnpackProjection(vsmProjectionData[h.id],h);}
`;

/**
 * Clipmap levels are computed in centimetres (`VSM_CM_PER_UNIT`): the
 * level of a distance d is 0.5·log2(d²) with d in cm.
 */
export const VSM_PROJECTION_SAMPLE_WGSL = /* wgsl */ `
/** The biased level of a distance, without a depth-of-field bias. A clipmap's levels all carry its
 *  one resolution bias (\`vsmClipmapProjectionData\`, \`clipmapBias.test.ts\`), the base level's among them,
 *  which the base record already holds. */
fn vsmSampledLevel(base:VsmProjectionData,distSqToOrigin:f32)->f32{
 return vsmLevelOfDistanceSq(distSqToOrigin)+base.levelBias;
}
struct VsmMapRead{
 depth:f32,
 mipLevel:u32,
 handle:VsmHandle,
 valid:bool,
 mapTexelXY:vec2u,
 mapTexelPos:vec2f,
 poolTexel:vec2u,
}
fn vsmEmptyRead()->VsmMapRead{return VsmMapRead(0.0,0u,vsmHandleInvalid(),false,vec2u(0u),vec2f(0.0),vec2u(0u));}
/** Slice 0 holds dynamic merged with static after the merge of the static pages. */
fn vsmPoolDepth(poolTexel:vec2u)->f32{return bitcast<f32>(vsmPoolLoad(poolTexel,0u));}
/** Local lights: follows the coarser-level count from finestMip. */
fn vsmReadMap(h:VsmHandle,mapUvAt:vec2f,finestMip:u32)->VsmMapRead{
 return vsmReadAt(h,vsmLocalPageAt(h,mapUvAt,finestMip));
}
/** \`vsmReadMap\` of the page \`page\` translated. */
fn vsmReadAt(h:VsmHandle,page:VsmLocalPage)->VsmMapRead{
 var r=vsmEmptyRead();
 if(page.valid){
  r.valid=true;
  r.mipLevel=page.coarserLevels;
  r.handle=h;
  r.mapTexelXY=page.mapTexelXY;
  r.mapTexelPos=page.mapTexelPos;
  r.poolTexel=page.poolTexel;
  r.depth=vsmPoolDepth(r.poolTexel);
 }
 return r;
}
struct VsmLevelToLevel{scale:f32,bias:vec3f,depthInverse:f32,}
/** The UV/depth transform from level h to level h + levelOffset. */
fn vsmLevelToLevelOf(h:VsmHandle,levelOffset:i32)->VsmLevelToLevel{
 // The two levels' fields it reads, not their whole records: a fallback sample of a ray reads them.
 let a=h.id;
 let b=vsmHandleOffset(h,levelOffset).id;
 let offsetA=vec2f(vsmProjectionData[a].cornerSteps);
 let offsetB=vec2f(vsmProjectionData[b].cornerSteps);
 var r:VsmLevelToLevel;
 r.scale=select(f32(1u<<u32(-levelOffset)),1.0/f32(1u<<u32(levelOffset)),levelOffset>=0);
 // The scale's inverse, as exact as it: a depth taken to this level multiplies by it, to the bit
 // what dividing by the scale gives (\`clipmapDepth.test.ts\`).
 r.depthInverse=select(1.0/f32(1u<<u32(-levelOffset)),f32(1u<<u32(levelOffset)),levelOffset>=0);
 r.bias=vec3f(0.25*(offsetB-r.scale*offsetA),0.0);
 let offsetZA=vsmProjectionData[a].lightViewToClip[3][2];
 let offsetZB=vsmProjectionData[b].lightViewToClip[3][2];
 r.bias.z=offsetZB-r.scale*offsetZA;
 return r;
}
/** The integer page transform to a coarser level (levelOffset > 0). */
fn vsmCoarserLevelPage(levelZeroPage:vec2u,h:VsmHandle,levelOffset:u32)->vec2u{
 let quarterPages=i32(VSM_LEVEL0_PAGES>>2u);
 let firstShiftPages=quarterPages*vsmProjectionData[h.id].cornerSteps;
 let levelShiftPages=quarterPages*vsmProjectionData[vsmHandleOffset(h,i32(levelOffset)).id].cornerSteps;
 // An unsigned page less a signed offset wraps (unsigned arithmetic), and >> is a logical shift.
 return (levelZeroPage-bitcast<vec2u>(firstShiftPages)+bitcast<vec2u>(levelShiftPages<<vec2u(levelOffset)))>>vec2u(levelOffset);
}
/** The level-0 page of a UV of the level. */
fn vsmClipmapBasePage(mapUvAt:vec2f)->vec2u{return vec2u(mapUvAt*f32(VSM_LEVEL0_PAGES));}
/** The page-table reads for the level-0 page \`levelZeroPage\` of level h: its entry's word, and
 *  that of the page its coarser-level count falls back to (the same word without one). */
struct VsmClipmapPage{levelZeroPage:vec2u,entry:u32,levelEntry:u32,}
fn vsmClipmapPage(h:VsmHandle,levelZeroPage:vec2u)->VsmClipmapPage{
 let entry=vsmTableWord(vsmTableEntryOf(h,0u,levelZeroPage));
 var levelEntry=entry;
 let e=vsmUnpackTableEntry(entry);
 if(e.anyLevelMapped&&e.coarserLevels>0u){
  let vPage=vsmCoarserLevelPage(levelZeroPage,h,e.coarserLevels);
  levelEntry=vsmTableWord(vsmTableEntryOf(vsmHandleOffset(h,i32(e.coarserLevels)),0u,vPage));
 }
 return VsmClipmapPage(levelZeroPage,entry,levelEntry);
}
/** Samples the clipmap: level 0 entry, then its coarser-level count to a coarser level. */
fn vsmReadClipmap(h:VsmHandle,mapUvAt:vec2f)->VsmMapRead{
 return vsmReadClipmapPage(h,vsmClipmapPage(h,vsmClipmapBasePage(mapUvAt)),mapUvAt);
}
/** The texel \`vsmReadClipmapPage\` reads at a UV of the page \`page\` of level h (\`vsmClipmapPage\`):
 *  where its coarser-level count falls back to a coarser level, that level's texel, clamped to its page, and
 *  the bias and inverse scale its raw depth takes to h's (\`vsmClipmapTexelDepth\`). \`valid\`: the
 *  texel is mapped. Where no level maps the page, the addresses are 0, as \`vsmEmptyRead\`'s. */
struct VsmClipmapTexel{
 valid:bool,
 levelHandle:VsmHandle,
 mapTexelXY:vec2u,
 mapTexelPos:vec2f,
 poolTexel:vec2u,
 depthLevelBias:f32,
 depthLevelInverse:f32,
}
fn vsmClipmapTexel(h:VsmHandle,page:VsmClipmapPage,mapUvAt:vec2f)->VsmClipmapTexel{
 var r:VsmClipmapTexel;
 // On the sample's own level (raw − 0)·1 is the raw depth (\`clipmapDepth.test.ts\`).
 r.depthLevelInverse=1.0;
 var e=vsmUnpackTableEntry(page.entry);
 if(e.anyLevelMapped){
  let levelGap=e.coarserLevels;
  r.levelHandle=vsmHandleOffset(h,i32(levelGap));
  r.mapTexelPos=mapUvAt*f32(vsmTexelsAtLevel(0u));
  r.mapTexelXY=vec2u(r.mapTexelPos);
  if(levelGap>0u){
   let vPage=vsmCoarserLevelPage(page.levelZeroPage,h,levelGap);
   let vMin=vPage*VSM_PAGE_TEXELS;
   let vMax=vMin+vec2u(VSM_PAGE_TEXELS-1u);
   let t=vsmLevelToLevelOf(h,i32(levelGap));
   let levelUv=mapUvAt*t.scale+t.bias.xy;
   r.depthLevelInverse=t.depthInverse;
   r.depthLevelBias=t.bias.z;
   r.mapTexelPos=levelUv*f32(vsmTexelsAtLevel(0u));
   r.mapTexelXY=clamp(vec2u(r.mapTexelPos),vMin,vMax);
   e=vsmUnpackTableEntry(page.levelEntry);
  }
  if(e.thisLevelMapped){
   r.poolTexel=e.physicalAddress*VSM_PAGE_TEXELS+(r.mapTexelXY&vec2u(VSM_PAGE_TEXEL_MASK));
   r.valid=true;
  }
 }
 return r;
}
/** A raw pool depth of \`t\`'s level as the sampled level reads it: (raw − bias)·inverse, which no
 *  greater raw depth makes smaller (rounding is monotonic, the inverse positive). */
fn vsmClipmapTexelDepth(t:VsmClipmapTexel,raw:f32)->f32{return (raw-t.depthLevelBias)*t.depthLevelInverse;}
/** \`vsmReadClipmap\` at a UV of the page \`page\` read (\`vsmClipmapPage\`). */
fn vsmReadClipmapPage(h:VsmHandle,page:VsmClipmapPage,mapUvAt:vec2f)->VsmMapRead{
 let t=vsmClipmapTexel(h,page,mapUvAt);
 var r=vsmEmptyRead();
 r.mapTexelPos=t.mapTexelPos;
 r.mapTexelXY=t.mapTexelXY;
 r.poolTexel=t.poolTexel;
 if(t.valid){
  r.depth=vsmClipmapTexelDepth(t,vsmPoolDepth(t.poolTexel));
  r.mipLevel=0u;
  r.handle=t.levelHandle;
  r.valid=true;
 }
 return r;
}
`;
