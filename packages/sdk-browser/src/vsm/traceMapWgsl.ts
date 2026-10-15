/**
 * THE MAP OF A LIGHT, as a ray reads it (`traceWgsl.ts`): which map a receiver's rays march — a
 * sun's clipmap level, a spot's map, a point light's cube face —, the texel a sample reads in it
 * (a clipmap level falling back to a coarser level, a local map to a coarser mip of the same
 * projection), and what the receiver's own texel sets: its size, the depth slope of its plane,
 * the bias that keeps a ray off it and the depth a unit of distance takes. One reading for every
 * light: the maps differ in their addressing alone.
 */
import { vsmProjectionSampleWgsl } from './projectionSampleWgsl.ts'
import { VSM_UNIT_PER_CM } from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_PAGE_LOOKUP_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { sinFromCosUnclamped } from '../../../math/src/wgsl/geometry.ts'
import { perspectiveDivide } from '../../../math/src/wgsl/projection.ts'

const CM = `${VSM_UNIT_PER_CM}`

/** The map of a light at a receiver and its texels, sampling the pages of `pool`. The host brings the
 *  light's struct (`VSM_TRACE_LIGHT_WGSL`) and the view `vsmView`. */
export const vsmTraceMapWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'vsmTraceMapWgsl',
    [
      vsmProjectionSampleWgsl(pool),
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      sinFromCosUnclamped,
      perspectiveDivide,
    ],
    `
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
 let uv=(pd.shiftedToMapUv*vec4f(rayOrigin+toMapShift,1.0)).xy;
 let t=vsmClipmapTexel(levelMap,vsmClipmapPage(levelMap,vsmClipmapBasePage(uv)),uv);
 if(t.valid&&t.levelHandle.id>levelMap.id){levelIndex+=i32(t.levelHandle.id-levelMap.id);}
 return vsmHandleOffset(h,levelIndex);
}
/** A light's map at a receiver \`shifted\` (the view's shifted frame): a sun's clipmap level mapped
 *  at its texel (\`vsmMappedLevel\`), none past the last; a spot's one map; the cube face of a point
 *  or rectangle light the receiver lies in. \`mip\` is the finest mip its reads start from. */
struct VsmLightMap{valid:bool,handle:VsmHandle,clipmap:bool,mip:u32,}
fn vsmLightMapAt(light:VsmProjectionLight,shifted:vec3f)->VsmLightMap{
 var r:VsmLightMap;
 let h=vsmHandleFromId(u32(light.mapId));
 if(vsmLightIsDirectional(light)){
  r.handle=vsmMappedLevel(h,shifted);
  r.valid=vsmHandleIsValid(r.handle);
  r.clipmap=true;
  return r;
 }
 r.handle=h;
 if(light.kind!=LIGHT_KIND_SPOT){r.handle=vsmHandleOffset(h,i32(vsmCubeFace(shifted-light.shiftedPosition)));}
 r.valid=true;
 r.mip=vsmProjectionOf(r.handle).finestMip;
 return r;
}
/** The texel a sample at \`uv\` of map \`h\` reads: its pool texel and the bias and inverse scale its
 *  raw depth takes to \`h\`'s depth (\`vsmMapTexelDepth\`: a coarser clipmap level's; 0 and 1 for a
 *  local map's coarser mip, the same projection). Invalid outside the map's square and where no
 *  level or mip maps it. */
struct VsmMapTexel{valid:bool,poolTexel:vec2u,depthBias:f32,depthInverse:f32,}
fn vsmMapTexel(h:VsmHandle,clipmap:bool,mip:u32,uv:vec2f)->VsmMapTexel{
 var r:VsmMapTexel;
 if(any(uv!=saturate(uv))){return r;}
 if(clipmap){
  let t=vsmClipmapTexel(h,vsmClipmapPage(h,vsmClipmapBasePage(uv)),uv);
  r.valid=t.valid;
  r.poolTexel=t.poolTexel;
  r.depthBias=t.depthLevelBias;
  r.depthInverse=t.depthLevelInverse;
  return r;
 }
 let page=vsmLocalPageAt(h,uv,mip);
 r.valid=page.valid;
 r.poolTexel=page.poolTexel;
 r.depthInverse=1.0;
 return r;
}
/** A raw pool depth of \`t\` as its map reads it: (raw − bias)·inverse, which no greater raw depth
 *  makes smaller (rounding is monotonic, the inverse positive). */
fn vsmMapTexelDepth(t:VsmMapTexel,raw:f32)->f32{return (raw-t.depthBias)*t.depthInverse;}
/** The depth slope in UV of the receiver's plane, normal \`n\` through \`pointInMap\`: a plane stays
 *  a plane under the map's projection, orthographic or perspective. */
fn vsmDepthGradientUv(pd:VsmProjectionData,pointInMap:vec3f,n:vec3f)->vec2f{
 let planeUv=pd.planesToMapUv*vec4f(n,-dot(n,pointInMap));
 return -planeUv.xy/planeUv.z;
}
/**
 * THE RECEIVER-PLANE BIAS OF A LIGHT'S RAYS, every light's one rule, known before any ray: the
 * depth the receiver's plane (\`uvDepthSlope\`) climbs across one texel of the map's finest mip
 * (\`texelUv\` wide) — the most it climbs from any start to the centre of the texel it reads,
 * |sx|·t/2 + |sy|·t/2, doubled —, held to \`cap\`. The ray line takes off it the depth its start
 * already gained toward the light (\`vsmRayLine\`): a start the screen segment moved past the
 * receiver needs less.
 */
fn vsmPlaneBias(uvDepthSlope:vec2f,texelUv:f32,cap:f32)->f32{
 return min(cap,(abs(uvDepthSlope.x)+abs(uvDepthSlope.y))*texelUv);
}
/** The depth a unit of view depth takes in the map at \`pointInMap\`: |M22·M33 − M32·M23| / w², the
 *  derivative of the map's z/w — an orthographic map's |M22|, a perspective one's |M32| / w². */
fn vsmDepthPerDistance(pd:VsmProjectionData,pointInMap:vec3f)->f32{
 let m=pd.lightViewToClip;
 let w=(pd.shiftedToMapUv*vec4f(pointInMap,1.0)).w;
 return abs(m[2][2]*m[3][3]-m[3][2]*m[2][3])/(w*w);
}
/** The receiver's texel in the world: a pixel's size at its view depth, at the map's resolution
 *  bias. The 0.1 floor is 0.1 cm (·${CM}). */
fn vsmReceiverPixelSize(pd:VsmProjectionData,sceneDepth:f32)->f32{
 let pixelWorldHere=vsmPixelWorldSize(sceneDepth,vsmView.viewToClip,vsmView.viewPixels.xy);
 return max(0.1*${CM},pixelWorldHere*exp2(pd.levelBias));
}
/** A local ray's reach toward its light, a share of the distance: three quarters of the way,
 *  sooner off the light's axis (\`VSM_TRACE_CONE_COT\`). */
fn vsmLocalRayReach(cosTheta:f32)->f32{
 let sinTheta=sinFromCosUnclamped(cosTheta);
 return 0.75*saturate(1.5/(cosTheta+VSM_TRACE_CONE_COT*sinTheta));
}
`,
  )
