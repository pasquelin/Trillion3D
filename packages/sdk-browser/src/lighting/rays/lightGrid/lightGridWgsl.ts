import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import {
  boxBehindPlane,
  rayBoxSpan,
  rayInverseDirection,
} from '../../../../../math/src/wgsl/geometry.ts'
import {
  LIGHT_GRID_HEADER as H,
  LIGHT_GRID_HEADER_WORDS,
  LIGHT_GRID_OVERFLOW,
  LIGHT_GRID_WIDTH,
} from './lightGridLayout.ts'
import { LIGHT_GRID_KIND_SHIFT } from './lightGridLights.ts'
import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'

/** The groups of cells the builder runs a side (an 8 by 8 group, a third dimension for each axis). */
export const LIGHT_GRID_GROUP = 8

/** The bindings of the builder's group 0. */
export const LIGHT_GRID_BUILD_BINDINGS = { params: 0, lights: 1, grid: 2 } as const
const B = LIGHT_GRID_BUILD_BINDINGS

/** The builder's entry point. */
export const LIGHT_GRID_ENTRY = 'lightGridBuild'

/** The words of the builder's parameters, in order (`LgParams`): the box (a vec4 each, the fourth word unused), then the cells a side, the lights a cell keeps, the axis, the local lights, and where the counts, the lists, the rank's bytes and the lists' length are. */
export const LIGHT_GRID_PARAM_WORDS = 16

/** The word `index` of the grid's texture as a texel. */
const TEXEL = `vec2u(i%${LIGHT_GRID_WIDTH}u,i/${LIGHT_GRID_WIDTH}u)`

/**
 * THE INTERSECTION TESTS of the builder: a box against a sphere, a box against the half space behind a plane, and a box against the part of a cone inside a sphere. The cone test is the exact one: the apex inside the box, the
 * axis across it, or one of the box's twelve edges crossing both the infinite cone (the solution of a quadratic, the ray's interval inside it) and the sphere.
 */
const LIGHT_GRID_TESTS_WGSL = wgslBlock(
  'LIGHT_GRID_TESTS_WGSL',
  [boxBehindPlane, rayBoxSpan, rayInverseDirection],
  `const LG_FAR:f32=3.0e38;
fn lgOverlap(a:vec2f,b:vec2f)->bool{return max(a.x,b.x)<min(a.y,b.y);}
fn lgBoxOverlapsSphere(lo:vec3f,hi:vec3f,centre:vec3f,radius:f32)->bool{
 let d=max(lo-centre,vec3f(0.0))+max(centre-hi,vec3f(0.0));
 return dot(d,d)<radius*radius;
}
fn lgRayOverlapsBox(o:vec3f,d:vec3f,tMax:f32,lo:vec3f,hi:vec3f)->bool{
 let span=rayBoxSpan(lo,hi,o,rayInverseDirection(d));
 return span.x<=min(span.y,tMax);
}
fn lgRayInCone(origin:vec3f,dir:vec3f,apex:vec3f,axis:vec3f,cosTheta:f32)->vec2f{
 let ba=axis*cosTheta;
 let oa=origin-apex;
 let m0=dot(ba,ba);
 let m1=dot(oa,ba);
 let m3=dot(dir,ba);
 let m4=dot(dir,oa);
 let m5=dot(oa,oa);
 let k2=m0*m0-m3*m3;
 let k1=m0*m0*m4-m1*m3;
 let k0=m0*m0*m5-m1*m1;
 let h=k1*k1-k2*k0;
 if(h>0.0){
  let s=sign(k2);
  let t=(-k1+vec2f(-s,s)*sqrt(h))/k2;
  let y=m1+t*m3;
  let c=select(0,1,y.x>0.0)+select(0,2,y.y>0.0);
  if(c==1){return vec2f(0.0,t.x);}
  if(c==2){return vec2f(t.y,LG_FAR);}
  if(c==3){return t;}
 }
 return vec2f(-1.0);
}
fn lgRayInSphere(origin:vec3f,dir:vec3f,centre:vec3f,radius:f32,tMin:f32,tMax:f32)->vec2f{
 let oc=origin-centre;
 let b=dot(oc,dir);
 let q=oc-b*dir;
 let h=radius*radius-dot(q,q);
 if(h>0.0){
  let t=-b+vec2f(-1.0,1.0)*sqrt(h);
  return vec2f(max(t.x,tMin),min(t.y,tMax));
 }
 return vec2f(-1.0);
}
fn lgEdgeInCone(origin:vec3f,dir:vec3f,length:f32,apex:vec3f,axis:vec3f,cosTheta:f32,radius:f32)->bool{
 return lgOverlap(lgRayInCone(origin,dir,apex,axis,cosTheta),lgRayInSphere(origin,dir,apex,radius,0.0,length));
}
fn lgBoxOverlapsCone(lo:vec3f,hi:vec3f,apex:vec3f,axis:vec3f,cosTheta:f32,radius:f32)->bool{
 if(all(lo<=apex)&&all(apex<=hi)){return true;}
 if(lgRayOverlapsBox(apex,axis,radius,lo,hi)){return true;}
 for(var b=0u;b<4u;b++){
  let u=(b&1u)!=0u;
  let v=(b&2u)!=0u;
  if(lgEdgeInCone(vec3f(lo.x,select(lo.y,hi.y,u),select(lo.z,hi.z,v)),vec3f(1.0,0.0,0.0),hi.x-lo.x,apex,axis,cosTheta,radius)){return true;}
  if(lgEdgeInCone(vec3f(select(lo.x,hi.x,u),lo.y,select(lo.z,hi.z,v)),vec3f(0.0,1.0,0.0),hi.y-lo.y,apex,axis,cosTheta,radius)){return true;}
  if(lgEdgeInCone(vec3f(select(lo.x,hi.x,u),select(lo.y,hi.y,v),lo.z),vec3f(0.0,0.0,1.0),hi.z-lo.z,apex,axis,cosTheta,radius)){return true;}
 }
 return false;
}`,
)

/**
 * THE LIGHT GRID'S BUILDER (`lightGridBuild`, a thread a cell of each axis): the box that holds the reach of the local lights (`lp.boundMin` to `lp.boundMax`) is cut in `lp.resolution` cells a side seen along each of the three axes, and the cell
 * (x, y) of an axis keeps, in the order of the lights, those whose sphere of reach overlaps the cell's box, whose face is not behind it (a spot, a rectangle) and, for a spot, whose cone does; its count is a word at `lp.countsAt`
 * (axis times the cells, then the row, then the column), its list `lp.stride` ranks from `lp.dataAt`, packed `lp.bytes` bytes a rank, at `stride * (axis + 3 * (x + resolution * y))`. The cells of the axes
 * that are not the grid's (`lp.axis` 0 to 2 forces one) are left empty. A cell that more than `lp.maxCount` lights overlap keeps no list: its count is `LIGHT_GRID_OVERFLOW`, and a lookup in it loops over every light. The lights' records are `lights` (`lightGridLights.ts`).
 */
export const lightGridBuildProgram = () =>
  wgslProgram(
    `struct LgLight{place:vec4f,axis:vec4f,tag:vec4u,}
struct LgParams{boundMin:vec4f,boundMax:vec4f,resolution:u32,maxCount:u32,axis:u32,finite:u32,countsAt:u32,dataAt:u32,bytes:u32,stride:u32,}
@group(0) @binding(${B.params}) var<uniform> lp:LgParams;
@group(0) @binding(${B.lights}) var<storage,read> lights:array<LgLight>;
@group(0) @binding(${B.grid}) var grid:texture_storage_2d<r32uint,write>;
fn lgPut(i:u32,value:u32){textureStore(grid,${TEXEL},vec4u(value));}
@compute @workgroup_size(${LIGHT_GRID_GROUP},${LIGHT_GRID_GROUP},1)
fn ${LIGHT_GRID_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let res=lp.resolution;
 if(any(id.xy>=vec2u(res))||id.z>=3u){return;}
 let axis=id.z;
 let cells=res*res;
 let countAt=lp.countsAt+axis*cells+id.y*res+id.x;
 if(axis!=lp.axis&&lp.axis<3u){
  lgPut(countAt,0u);
  return;
 }
 var voxel=vec3u(0u);
 var span=vec3u(1u);
 switch axis{
  case 0u:{voxel=vec3u(0u,id.x,id.y);span=vec3u(1u,res,res);}
  case 1u:{voxel=vec3u(id.x,0u,id.y);span=vec3u(res,1u,res);}
  default:{voxel=vec3u(id.x,id.y,0u);span=vec3u(res,res,1u);}
 }
 let lo=mix(lp.boundMin.xyz,lp.boundMax.xyz,vec3f(voxel)/vec3f(span));
 let hi=mix(lp.boundMin.xyz,lp.boundMax.xyz,vec3f(voxel+vec3u(1u))/vec3f(span));
 let perWord=4u/lp.bytes;
 let first=lp.stride*(axis+3u*(id.x+res*id.y));
 var visible=0u;
 var packed=0u;
 var overflow=false;
 for(var i=0u;i<lp.finite;i++){
  let light=lights[i];
  let centre=light.place.xyz;
  let radius=light.place.w;
  let normal=light.axis.xyz;
  let kind=light.tag.x>>${LIGHT_GRID_KIND_SHIFT}u;
  if(!lgBoxOverlapsSphere(lo,hi,centre,radius)){continue;}
  if(kind!=${LIGHT_KIND.point}u&&boxBehindPlane(vec4f(normal,-dot(normal,centre)),lo,hi)){continue;}
  if(kind==${LIGHT_KIND.spot}u&&!lgBoxOverlapsCone(lo,hi,centre,normal,light.axis.w,radius)){continue;}
  if(visible>=lp.maxCount){
   overflow=true;
   break;
  }
  let entry=first+visible;
  let rank=light.tag.x&0x3fffffffu;
  packed|=rank<<((entry%perWord)*lp.bytes*8u);
  visible++;
  if(entry%perWord==perWord-1u){
   lgPut(lp.dataAt+entry/perWord,packed);
   packed=0u;
  }
 }
 // The last word of a list that does not end a word.
 if(!overflow&&visible>0u&&(first+visible)%perWord!=0u){lgPut(lp.dataAt+(first+visible)/perWord,packed);}
 lgPut(countAt,select(visible,${LIGHT_GRID_OVERFLOW}u,overflow));
}`,
    [LIGHT_GRID_TESTS_WGSL],
  )

/**
 * THE LOOKUP A HOST'S LIGHT LOOP READS (`litCellOf`, `litCellRank`): the lights that can reach a point, as a count and a place in the grid. The suns come first at every point; a point inside the box of the local lights also finds the
 * lights of its cell, in the axis whose cell keeps the fewest where the axis is not forced, the point's column and row being clamped to the cells (a point on the far face is in the last one). With the grid not kept (`all`), or in a cell that more lights overlap than it keeps, every light is looped over.
 * `binding` is the grid's texture in group 0 (read-only); `directLights` is the lights' buffer.
 */
export const lightGridLookupWgsl = (binding: number) =>
  wgslBlock(
    `LIGHT_GRID_LOOKUP_WGSL(${binding})`,
    [],
    `@group(0) @binding(${binding}) var lightGrid:texture_storage_2d<r32uint,read>;
/** The lights a point can be reached by: how many, where the cell's list begins in ranks (a marker when every light counts), and what the ranks are read with: the suns, the bytes of a rank and where the lists begin. */
struct LitCell{count:u32,offset:u32,suns:u32,bytes:u32,dataAt:u32,}
const LIT_CELL_ALL:u32=0xfffffffeu;
fn lgWord(i:u32)->u32{return textureLoad(lightGrid,${TEXEL}).x;}
fn lgBound(i:u32)->f32{return bitcast<f32>(lgWord(i));}
fn litCellOf(point:vec3f)->LitCell{
 if(lgWord(${H.all}u)!=0u){return LitCell(directLights.count,LIT_CELL_ALL,0u,0u,0u);}
 var cell=LitCell(lgWord(${H.suns}u),0u,lgWord(${H.suns}u),lgWord(${H.bytes}u),lgWord(${H.dataAt}u));
 let boundMin=vec3f(lgBound(${H.boundMin}u),lgBound(${H.boundMin + 1}u),lgBound(${H.boundMin + 2}u));
 let boundMax=vec3f(lgBound(${H.boundMax}u),lgBound(${H.boundMax + 1}u),lgBound(${H.boundMax + 2}u));
 if(all(boundMin<=point)&&all(point<=boundMax)){
  let res=lgWord(${H.resolution}u);
  let p=point-boundMin;
  let d=boundMax-boundMin;
  let last=vec2i(i32(res)-1);
  let uvx=clamp(vec2i(floor(f32(res)*p.yz/d.yz)),vec2i(0),last);
  let uvy=clamp(vec2i(floor(f32(res)*p.xz/d.xz)),vec2i(0),last);
  let uvz=clamp(vec2i(floor(f32(res)*p.xy/d.xy)),vec2i(0),last);
  let cells=res*res;
  let countsAt=lgWord(${H.countsAt}u);
  let axis=lgWord(${H.axis}u);
  let stride=lgWord(${H.stride}u);
  let nx=lgWord(countsAt+u32(uvx.y)*res+u32(uvx.x));
  let ny=lgWord(countsAt+cells+u32(uvy.y)*res+u32(uvy.x));
  let nz=lgWord(countsAt+2u*cells+u32(uvz.y)*res+u32(uvz.x));
  var n=nx;
  var list=stride*(0u+3u*(u32(uvx.x)+u32(uvx.y)*res));
  if((axis>=3u&&ny<n)||axis==1u){
   n=ny;
   list=stride*(1u+3u*(u32(uvy.x)+u32(uvy.y)*res));
  }
  if((axis>=3u&&nz<n)||axis==2u){
   n=nz;
   list=stride*(2u+3u*(u32(uvz.x)+u32(uvz.y)*res));
  }
  if(n==${LIGHT_GRID_OVERFLOW}u){return LitCell(directLights.count,LIT_CELL_ALL,0u,0u,0u);}
  cell.offset=list;
  cell.count+=n;
 }
 return cell;
}
/** The rank of the light n of a cell: the suns first, then the cell's list. */
fn litCellRank(n:u32,cell:LitCell)->u32{
 if(cell.offset==LIT_CELL_ALL){return n;}
 if(n<cell.suns){return lgWord(${LIGHT_GRID_HEADER_WORDS}u+n);}
 let perWord=4u/cell.bytes;
 let entry=cell.offset+n-cell.suns;
 let word=lgWord(cell.dataAt+entry/perWord);
 if(cell.bytes==4u){return word;}
 return (word>>((entry%perWord)*cell.bytes*8u))&((1u<<(cell.bytes*8u))-1u);
}`,
  )
