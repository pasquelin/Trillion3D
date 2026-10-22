import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  perspectiveDivide,
  transformHomogeneousPoint,
} from '../../../../math/src/wgsl/projection.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { ROOT_BOX_DOUBLES } from '../../placement/roots/rootWorldSends.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../../visibility/shader/pageWgsl.ts'
import { visPageIndex } from '../../visibility/visWords.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { TAA_REPROJECT_WGSL } from './deformWgsl.ts'
import { DEPTH_WGSL } from './depthWgsl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { REPROJECTION_VECTOR_WGSL } from './velocityWgsl.ts'

/** The bindings of what the velocity passes read of the frame, whichever their outputs. */
export const VELOCITY_INPUT_BINDINGS = {
  view: 0,
  depth: 1,
  ids: 2,
  pages: 3,
  motion: 4,
  indices: 5,
  positions: 6,
  uvs: 7,
  boxes: 8,
  normals: 9,
} as const

/**
 * What the velocity passes read, declared once for every pass that measures it: the pass uniform,
 * the depth, the visibility identifiers, the page records, the placements' motion, the pools a
 * deformed or displaced pixel's triangle is read from — the normal atlas beside them, which a
 * displaced one's prism is solved with — and the roots' world boxes (`rootBoxes`, doubles, the
 * root boxes pass's, `../../placement/roots/rootBoxesWgsl.ts`), which tell how large an object is.
 */
const VELOCITY_INPUTS_WGSL = wgslBlock(
  'VELOCITY_INPUTS_WGSL',
  [PAGE_INFO_STRUCT_WGSL, TAA_VIEW_WGSL, normalAtlasWgsl(VELOCITY_INPUT_BINDINGS.normals)],
  `
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.motion}) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
@group(0) @binding(${VELOCITY_INPUT_BINDINGS.boxes}) var<storage,read> boxes:array<vec2u>;`,
)

/**
 * The motion of a surface point, in the pass uniform's view (`view`): `lastScreenMotion` takes the
 * point `before` — where the last image had a point that is at `screen` and depth `z` in this one,
 * relative to this eye — to the last view: its device position less the last one, its depth step,
 * and `shift`, how far the point moved by itself; a point behind the last view left no trace in
 * the last image and is put off its screen. `cameraOnlyMotion` is the same for a point that did not
 * move by itself: the motion the camera's alone gives.
 */
export const CAMERA_MOTION_WGSL = wgslBlock(
  'CAMERA_MOTION_WGSL',
  [perspectiveDivide, transformHomogeneousPoint],
  `
struct TaaMotion{velocity:vec3f,shift:f32}
fn lastScreenMotion(screen:vec2f,z:f32,before:vec4f,shift:f32)->TaaMotion{
 let prev=view.prevViewProj*before;
 if(prev.w<=0.0){return TaaMotion(vec3f(screen+vec2f(4.0),0.0),shift);}
 let p=perspectiveDivide(prev);
 return TaaMotion(vec3f(screen-p.xy,z-p.z),shift);
}
fn cameraOnlyMotion(screen:vec2f,z:f32)->vec2f{
 let here=transformHomogeneousPoint(view.invViewProj,vec3f(screen,z));
 return lastScreenMotion(screen,z,here,0.0).velocity.xy;
}`,
)

/**
 * What a velocity pass measures a surface point by, declared once for every pass that reads the
 * frame's surfaces (`VELOCITY_INPUT_BINDINGS`):
 * - `drawsMotion`: whether the surface at identifier `id` moves by itself — a placement whose motion
 *   is not the identity, a deformed geometry — and is large enough on the screen to be measured
 *   (`smallObject`, `perObjectSize`: an object under it is left out, as one the velocity is not
 *   drawn for, and is measured as a surface that did not move by itself);
 * - `surfaceMotion`: the motion of the surface point a texel shows, `moves` saying whether its own
 *   motion carries it back (`pointBefore`) before the camera's does; `texelMotion`: that of texel
 *   `p`'s surface, taken at texel `q` — the one it was found at — where it moves by itself, else
 *   at `p`'s own centre and depth, so the camera's motion alone moves it.
 */
export const SURFACE_MOTION_WGSL = wgslBlock(
  'SURFACE_MOTION_WGSL',
  [
    VELOCITY_INPUTS_WGSL,
    CAMERA_MOTION_WGSL,
    TAA_REPROJECT_WGSL,
    REPROJECTION_VECTOR_WGSL,
    visPageIndex,
    perspectiveDivide,
    transformHomogeneousPoint,
    toF32,
  ],
  `fn boxCorner(at:u32)->vec3f{
 return vec3f(bitcast<f32>(toF32(boxes[at])),bitcast<f32>(toF32(boxes[at+1u])),bitcast<f32>(toF32(boxes[at+2u])));
}
fn smallObject(rank:u32)->bool{
 if(view.rates.w<=0.0){return false;}
 let at=rank*${ROOT_BOX_DOUBLES}u;
 let low=boxCorner(at);
 let high=boxCorner(at+3u);
 let radius=length(high-low)*0.5*${CENTIMETRES_PER_METRE}.0;
 if(!(radius>0.0)){return false;}
 let offset=(low+high)*0.5-view.eye.xyz;
 let reach=select(dot(offset,offset)*${CENTIMETRES_PER_METRE * CENTIMETRES_PER_METRE}.0,0.0,view.radius.w!=0.0);
 let screen=view.rates.z*radius;
 return screen*screen/max(1.0,reach)<view.rates.w;
}
fn drawsMotion(id:u32)->bool{
 if(id==0u){return false;}
 let page=pages[visPageIndex(id)];
 var moves=view.eye.w!=0.0&&page.deformOutput!=0u;
 if(!moves&&view.params.z!=0.0){
  let m=motion[page.placement];
  moves=any(m[0]!=vec4f(1.0,0.0,0.0,0.0))||any(m[1]!=vec4f(0.0,1.0,0.0,0.0))||any(m[2]!=vec4f(0.0,0.0,1.0,0.0))||any(m[3]!=vec4f(0.0,0.0,0.0,1.0));
 }
 return moves&&!smallObject(page.placement);
}
fn surfaceMotion(screen:vec2f,z:f32,id:u32,moves:bool)->TaaMotion{
 let here=transformHomogeneousPoint(view.invViewProj,vec3f(screen,z));
 var before=here;
 if(moves){before=pointBefore(here,id);}
 var shift=0.0;
 if(here.w!=0.0&&before.w!=0.0){shift=length(perspectiveDivide(before)-perspectiveDivide(here));}
 return lastScreenMotion(screen,z,before,shift);
}
fn texelMotion(p:vec2i,q:vec2i,z:f32,id:u32)->TaaMotion{
 let moves=drawsMotion(id);
 return surfaceMotion(screenOfTexel(select(p,q,moves)),z,id,moves);
}`,
)

/**
 * The nearest surface of a render texel (`nearestSurface`), what the temporal pass's analysis starts
 * from:
 * - the 3×3's depths, and the closest of the two horizontal and the two vertical neighbours that
 *   stand out of the texel — their mean nearer than the texel by more than a quarter of their own
 *   difference and than the texel's pixel depth error (`pixelDeviceZError`) —: on a flat surface the
 *   texel keeps its own velocity, on a depth edge it takes the foreground's. The depth and its
 *   offset are packed in one word, the offset in the low four bits, so one maximum picks both;
 * - the closest surface's motion (`texelMotion`).
 * 9 depth loads, one identifier load — two where the texel takes a neighbour's velocity — and one
 * reprojection.
 */
export const NEAREST_SURFACE_WGSL = wgslBlock(
  'NEAREST_SURFACE_WGSL',
  [SURFACE_MOTION_WGSL, DEPTH_WGSL, TILE_CLAMP_WGSL],
  `fn packDepthOffset(o:vec2i,z:f32)->u32{return ((bitcast<u32>(z)<<2u)&~0xfu)|u32(1+o.x)|(u32(1+o.y)<<2u);}
struct NearestSurface{depths:array<f32,9>,closestZ:f32,offset:vec2i,id:u32,motion:TaaMotion}
fn nearestSurface(p:vec2i)->NearestSurface{
 var z:array<f32,9>;
 for(var k=0;k<9;k++){z[k]=textureLoad(depth,clampTexel(p+vec2i(k%3-1,k/3-1)),0);}
 let zc=z[4];
 let zError=pixelDeviceZError(zc);
 var packed=packDepthOffset(vec2i(0),zc);
 for(var axis=0;axis<2;axis++){
  let pair=select(vec2i(0,1),vec2i(1,0),axis==0);
  let z0=z[4+pair.x+3*pair.y];let z1=z[4-pair.x-3*pair.y];
  if((z0+z1)*0.5-zc>max(abs(z1-z0)*0.25,zError)){
   packed=max(packed,packDepthOffset(pair,z0));
   packed=max(packed,packDepthOffset(-pair,z1));
  }
 }
 let closestZ=bitcast<f32>((packed&~0xfu)>>2u);
 let offset=vec2i(i32(packed&3u),i32((packed>>2u)&3u))-vec2i(1);
 let id=textureLoad(ids,p,0).r;
 // The closest neighbour's identifier, a second load only where the texel took a neighbour's.
 let q=clampTexel(p+offset);
 var nearId=id;
 if(any(q!=p)){nearId=textureLoad(ids,q,0).r;}
 return NearestSurface(z,closestZ,offset,id,texelMotion(p,q,closestZ,nearId));
}`,
)
