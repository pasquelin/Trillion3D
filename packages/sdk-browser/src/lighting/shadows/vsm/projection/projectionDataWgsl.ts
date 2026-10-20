/**
 * The projection shader data (the host twin is in `projectionData.ts`) and the projection-side
 * page sampling helpers.
 *
 * `VsmProjectionRecord` is the exact memory record (`VSM_PROJECTION_RECORD_BYTES`) — offsets in
 * `projectionData.ts`. Matrices are the engine's column-major ones, WGSL's mat4x4f: `M * v`
 * transforms a column vector and `M[i][j]` is column i, row j.
 *
 * Declarations:
 * - `VSM_PROJECTION_DATA_WGSL`: the raw and decoded structs and the decode (no bindings), and the
 *   helpers every pass shares, each the one text of its maths: the clipmap level and distance, the
 *   cube face, a view's depth from device depth, a pixel's world size and a local map's pixel
 *   footprint, a sun's back face.
 * - `VSM_PROJECTION_DATA_READ_WGSL`: `vsmProjectionOf(handle)`, through the module's
 *   `vsmProjectionData` binding.
 * The page sampling is `projectionSampleWgsl.ts`'s.
 */
import { VSM_CONSTANTS_WGSL, VSM_UNIT_PER_CM } from '../constants.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'

const CM = `${VSM_UNIT_PER_CM}`

export const VSM_PROJECTION_DATA_WGSL = wgslBlock(
  'VSM_PROJECTION_DATA_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_HANDLE_WGSL],
  `
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
 tableOrigin:u32,
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
 tableOrigin:u32,
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
 r.tableOrigin=raw.tableOrigin;
 r.uncached=(r.flags&VSM_MAP_UNCACHED)!=0u;
 r.lightUnseen=(r.flags&VSM_MAP_UNSEEN)!=0u;
 r.coarseLevel=(r.flags&VSM_MAP_COARSE)!=0u;
 r.useCover=(r.flags&VSM_MAP_COVERAGE)!=0u;
 r.coarseDynamicCached=(r.flags&VSM_MAP_COARSE_KEEPS_DYNAMIC)!=0u;
 return r;
}
/** The shifted-to-clip matrix of a map, from its record's shiftedToMapUv
 *  (the clip-to-UV scale and bias inverted: x = 2u − w, y = w − 2v, z and w kept). */
fn vsmShiftedToClip(uv:mat4x4f)->mat4x4f{
 var m:mat4x4f;
 for(var k=0u;k<4u;k++){
  let c=uv[k];
  m[k]=vec4f(2.0*c.x-c.w,c.w-2.0*c.y,c.z,c.w);
 }
 return m;
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
`,
)

/** Reads a map's projection data, through the module's `vsmProjectionData` binding. */
export const VSM_PROJECTION_DATA_READ_WGSL = wgslBlock(
  'VSM_PROJECTION_DATA_READ_WGSL',
  [VSM_HANDLE_WGSL, VSM_PROJECTION_DATA_WGSL],
  `
fn vsmProjectionOf(h:VsmHandle)->VsmProjectionData{return vsmUnpackProjection(vsmProjectionData[h.id],h);}
`,
)
