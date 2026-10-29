import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_LIGHT, PT_LIGHT_MAXIMUM } from './lightRecords.ts'

/** The width, in texels, of the texture that holds the grid's lists of lights (a list starts at `offset`, in row `offset / width`). */
export const PT_GRID_DATA_WIDTH = 4096

/** The grid's parameters (`ptGridParams`, a uniform): the box that holds the lamps' spheres of influence (`boundMin`, `boundMax`; none when they are empty), the cells a side, the most lights
 *  a cell keeps, the axis (0 to 2 forces it, 3 or more picks the best cell by cell), the lights at infinity (the sky and the suns, which come first) and all the lights, then the view of the payload drawn (`pathTracingVisualize`, written at each image), the count its ramps end at and the length of its occlusion ray. */
export const PT_GRID_PARAMS_WGSL = wgslBlock(
  'PT_GRID_PARAMS_WGSL',
  [],
  'struct PtGridParams{boundMin:vec4f,boundMax:vec4f,resolution:u32,maxCount:u32,axis:u32,infinite:u32,count:u32,visualize:u32,visualizeMax:u32,visualizeAo:f32,}',
)

/** The kernel that makes the light grid, 8 by 8 cells a group, a third group for each axis. */
export const PT_LIGHT_GRID_ENTRY = 'ptBuildLightGrid'

/** The bit of a cell's count that says every light of its list is a point of no size (no sampling of the light by the material's rays is worth its cost), under
 *  which the count is. */
const SINGULAR = '0x80000000u'

/**
 * THE LIGHT GRID the path tracer culls its lights with, made once for the lights of an image (`ptBuildLightGrid`, a thread a cell): the box that holds the
 * spheres of influence of the lamps and rectangles (`ptGridParams.boundMin` to `boundMax`) is cut in `resolution` cells a side seen along each of the three axes,
 * so that a point finds, in the plane across the axis, the cell that holds it and the lamps and rectangles that reach somewhere along its line (`ptLightGrid`, a
 * layer for each axis, the count of lights of the cell; their numbers follow in `ptLightGridData`, `maxCount` a cell, from `maxCount * (axis + 3 * (x + resolution * y))`).
 * A light is kept for a cell if its sphere of influence overlaps the cell's box and, for a spot, if its cone does (the box of the cone's round end), for a rectangle if
 * the cell is not behind its face; a lamp of no size and no cone goes in the cell by its sphere alone. A cell left with lamps of no size alone has its count marked
 * (the top bit): the material's rays then have nothing of it to meet. The cells of the axes that are not the grid's (`axis` 0 to 2 forces one) are empty; with
 * `axis` 3 or more every axis is made and the lookup takes the one with the fewest lights.
 *
 * `ptGridLookup(point)` gives the lights of the cell a point falls in: how many, and where their numbers start; beyond the box, only the lights at infinity are looped over.
 */
export const PT_LIGHT_GRID_WGSL = wgslBlock(
  'PT_LIGHT_GRID_WGSL',
  [PT_GRID_PARAMS_WGSL],
  `struct PtGridCell{lights:u32,mis:u32,offset:u32,}
fn ptGridDataAt(index:u32)->u32{
 return textureLoad(ptLightGridData,vec2i(i32(index%${PT_GRID_DATA_WIDTH}u),i32(index/${PT_GRID_DATA_WIDTH}u)),0).x;
}
fn ptGridLookup(point:vec3f)->PtGridCell{
 var cell=PtGridCell(ptGridParams.infinite,ptGridParams.infinite,0xffffffffu);
 if(all(ptGridParams.boundMin.xyz<=point)&&all(point<=ptGridParams.boundMax.xyz)){
  let p=point-ptGridParams.boundMin.xyz;
  let d=ptGridParams.boundMax.xyz-ptGridParams.boundMin.xyz;
  let res=f32(ptGridParams.resolution);
  let uvx=vec2i(floor(res*p.yz/d.yz));
  let uvy=vec2i(floor(res*p.xz/d.xz));
  let uvz=vec2i(floor(res*p.xy/d.xy));
  let nx=textureLoad(ptLightGrid,uvx,0,0).x;
  let ny=textureLoad(ptLightGrid,uvy,1,0).x;
  let nz=textureLoad(ptLightGrid,uvz,2,0).x;
  var n=nx;
  var offset=ptGridParams.maxCount*(0u+3u*(u32(uvx.x)+u32(uvx.y)*ptGridParams.resolution));
  let counts=vec3u(nx,ny,nz)&vec3u(0x7fffffffu);
  if((ptGridParams.axis>=3u&&counts.y<counts.x)||ptGridParams.axis==1u){
   n=ny;
   offset=ptGridParams.maxCount*(1u+3u*(u32(uvy.x)+u32(uvy.y)*ptGridParams.resolution));
  }
  if((ptGridParams.axis>=3u&&counts.z<(n&0x7fffffffu))||ptGridParams.axis==2u){
   n=nz;
   offset=ptGridParams.maxCount*(2u+3u*(u32(uvz.x)+u32(uvz.y)*ptGridParams.resolution));
  }
  cell.offset=offset;
  cell.lights+=n&0x7fffffffu;
  if((n&${SINGULAR})==0u){cell.mis=cell.lights;}
 }
 return cell;
}
fn ptGridLightId(index:u32,cell:PtGridCell)->u32{
 if(index>=ptGridParams.infinite){return ptGridDataAt(cell.offset+index-ptGridParams.infinite);}
 return index;
}`,
)

/** The grid's builder, over the lights `directLights.lights` (declared by the program) and the outputs `ptLightGridOut`, `ptLightGridDataOut`. */
export const PT_BUILD_LIGHT_GRID_WGSL = wgslBlock(
  'PT_BUILD_LIGHT_GRID_WGSL',
  [PT_GRID_PARAMS_WGSL],
  `fn ptBoxOverlapsSphere(lo:vec3f,hi:vec3f,centre:vec3f,radius:f32)->bool{
 let d=max(lo-centre,vec3f(0.0))+max(centre-hi,vec3f(0.0));
 return dot(d,d)<radius*radius;
}
fn ptBoxBehindPlane(lo:vec3f,hi:vec3f,normal:vec3f,centre:vec3f)->bool{
 return dot(select(lo,hi,normal>vec3f(0.0))-centre,normal)<0.0;
}
fn ptBoxOverlapsCone(lo:vec3f,hi:vec3f,apex:vec3f,axis:vec3f,cosTheta:f32,radius:f32)->bool{
 let tip=apex+axis*radius;
 var boundLo=min(apex,tip);
 var boundHi=max(apex,tip);
 let sin2=1.0-cosTheta*cosTheta;
 let disc=sqrt(saturate(sin2*(vec3f(1.0)-axis*axis)));
 boundLo=min(boundLo,apex+radius*(axis*cosTheta-disc));
 boundHi=max(boundHi,apex+radius*(axis*cosTheta+disc));
 let far=select(apex,apex+radius*sign(axis),abs(axis)>vec3f(cosTheta));
 boundLo=min(boundLo,far);
 boundHi=max(boundHi,far);
 return all(max(lo,boundLo)<min(hi,boundHi));
}
@compute @workgroup_size(8,8,1)
fn ${PT_LIGHT_GRID_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let resolution=ptGridParams.resolution;
 if(any(id.xy>=vec2u(resolution))||id.z>=3u){return;}
 let axis=id.z;
 if(ptGridParams.axis!=axis&&ptGridParams.axis<3u){
  textureStore(ptLightGridOut,vec2i(id.xy),i32(axis),vec4u(0u));
  return;
 }
 var voxel=vec3u(0u);
 var cells=vec3u(1u);
 switch axis{
  case 0u:{voxel=vec3u(0u,id.x,id.y);cells=vec3u(1u,resolution,resolution);}
  case 1u:{voxel=vec3u(id.x,0u,id.y);cells=vec3u(resolution,1u,resolution);}
  default:{voxel=vec3u(id.x,id.y,0u);cells=vec3u(resolution,resolution,1u);}
 }
 let boundMin=ptGridParams.boundMin.xyz;
 let boundMax=ptGridParams.boundMax.xyz;
 let lo=mix(boundMin,boundMax,vec3f(voxel)/vec3f(cells));
 let hi=mix(boundMin,boundMax,vec3f(voxel+vec3u(1u))/vec3f(cells));
 var visible=0u;
 let most=min(ptGridParams.maxCount,${PT_LIGHT_MAXIMUM}u-ptGridParams.infinite);
 let offset=ptGridParams.maxCount*(axis+3u*(id.x+resolution*id.y));
 var singular=true;
 for(var index=ptGridParams.infinite;index<ptGridParams.count;index++){
  let light=directLights.lights[index];
  let kind=u32(light.position.w);
  let radius=light.colour.w;
  if(!ptBoxOverlapsSphere(lo,hi,light.position.xyz,radius)){continue;}
  if(kind!=${PT_LIGHT.point}u&&ptBoxBehindPlane(lo,hi,light.axis.xyz,light.position.xyz)){continue;}
  if(kind==${PT_LIGHT.spot}u&&!ptBoxOverlapsCone(lo,hi,light.position.xyz,light.axis.xyz,light.size.z,radius)){continue;}
  singular=singular&&kind!=${PT_LIGHT.rect}u&&light.tangent.w==0.0;
  let slot=offset+visible;
  textureStore(ptLightGridDataOut,vec2i(i32(slot%${PT_GRID_DATA_WIDTH}u),i32(slot/${PT_GRID_DATA_WIDTH}u)),vec4u(index));
  visible++;
  if(visible>=most){break;}
 }
 if(singular){visible|=${SINGULAR};}
 textureStore(ptLightGridOut,vec2i(id.xy),i32(axis),vec4u(visible));
}`,
)
