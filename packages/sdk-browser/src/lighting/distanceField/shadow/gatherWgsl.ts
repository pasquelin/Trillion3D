import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'
import { DFSH_COMMON_WGSL } from './commonWgsl.ts'
import { DFSH_BINDING as B, DFSH_GATHER_OBJECTS, DFSH_TILE } from './layout.ts'
import { DFSH_TRACE_OBJECT_WGSL, DFSH_TRACE_PIXEL_WGSL } from './traceWgsl.ts'

/**
 * THE CASCADE TRACED WITH EACH GROUP CULLING ITS OWN MESHES (`dfshTraceGather`), the trace where the
 * meshes are not scattered to a grid of tiles (`distanceFieldShadowScatterTiles` off): a group of
 * texels (8 by 8, so `8 * down` pixels across) works out the depths of its pixels the cascade
 * reaches — the nearest and the farthest, then the nearest of those at or past their middle and the
 * farthest of those at or before it —, and from them two bounding spheres of the group's slice of
 * the view, the box of the group's screen rectangle between the nearest depth and the farthest of the
 * near half, and between the nearest of the far half and the farthest (a box in the view's axes,
 * its circumscribed sphere); each thread tests some of the culled meshes against both spheres grown
 * by the mesh's radius (`dfshSegmentHitsSphere`: the ray from the sphere's centre toward the light,
 * as long as the trace distance, meets it) and appends the ones it keeps to the list of that sphere
 * in the group's memory, which holds `DFSH_GATHER_OBJECTS` and loses the rest. A pixel then takes
 * the list of the half it lies in (past the farthest of the near half, the far one) and traces
 * through it (`dfshTraceObject`) as the scattered trace does. The group's rectangle is the pixels it
 * covers, held to the view.
 */
export const DFSH_GATHER_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read> culledObjects:array<u32>;
@group(0) @binding(${B.objectArgs}) var<storage,read> objectArgs:array<u32>;
const GATHER_OBJECTS=${DFSH_GATHER_OBJECTS}u;
const GATHER_THREADS=${DFSH_TILE * DFSH_TILE}u;
var<workgroup> depthBounds:array<atomic<u32>,4>;
var<workgroup> listCounts:array<atomic<u32>,2>;
var<workgroup> lists:array<u32,${2 * DFSH_GATHER_OBJECTS}>;
fn dfshDeviceZ(distance:f32)->f32{
 let metres=distance*0.01;
 return select(1.0-(metres-dfsh.depth.y)/dfsh.depth.x,dfsh.depth.x/metres,dfsh.depth.z>0.5);
}
fn dfshViewOf(p:vec3f)->vec3f{
 return vec3f(dot(dfsh.axes[0].xyz,p),dot(dfsh.axes[1].xyz,p),dot(dfsh.axes[2].xyz,p));
}
fn dfshFromView(v:vec3f)->vec3f{
 return dfsh.axes[0].xyz*v.x+dfsh.axes[1].xyz*v.y+dfsh.axes[2].xyz*v.z;
}
fn dfshSliceSphere(low:vec2f,high:vec2f,near:f32,far:f32)->vec4f{
 var least=vec3f(3.4e38);
 var most=vec3f(-3.4e38);
 for(var i=0u;i<8u;i++){
  let ndc=vec2f(select(low.x,high.x,(i&1u)!=0u),select(low.y,high.y,(i&2u)!=0u));
  let corner=dfshViewOf(dfshPosition(ndc,dfshDeviceZ(select(near,far,(i&4u)!=0u))));
  least=min(least,corner);
  most=max(most,corner);
 }
 let middle=0.5*(least+most);
 return vec4f(dfshFromView(middle),length(most-middle));
}
fn dfshSegmentHitsSphere(origin:vec3f,direction:vec3f,reach:f32,centre:vec3f,radius:f32)->bool{
 let along=dot(centre-origin,direction);
 let offset=origin+along*direction-centre;
 return dot(offset,offset)<=radius*radius&&along>-radius&&along-radius<reach;
}
@compute @workgroup_size(${DFSH_TILE},${DFSH_TILE})
fn dfshTraceGather(
 @builtin(global_invocation_id) id:vec3u,
 @builtin(local_invocation_index) lane:u32,
 @builtin(workgroup_id) tileId:vec3u,
){
 let size=dfshCellsOf();
 let inside=all(id.xy<size);
 var block:DfshBlock;
 if(inside){block=dfshBlockOf(id.xy);}
 if(lane==0u){
  atomicStore(&depthBounds[0],0x7F7FFFFFu);
  atomicStore(&depthBounds[1],0u);
  atomicStore(&depthBounds[2],0x7F7FFFFFu);
  atomicStore(&depthBounds[3],0u);
  atomicStore(&listCounts[0],0u);
  atomicStore(&listCounts[1],0u);
 }
 workgroupBarrier();
 let near=dfsh.range.x;
 let far=dfsh.range.y;
 if(inside&&block.depth>near&&block.depth<far){
  atomicMin(&depthBounds[0],bitcast<u32>(block.depth));
  atomicMax(&depthBounds[1],bitcast<u32>(block.depth));
 }
 workgroupBarrier();
 let nearest=bitcast<f32>(atomicLoad(&depthBounds[0]));
 let farthest=bitcast<f32>(atomicLoad(&depthBounds[1]));
 let middle=0.5*(nearest+farthest);
 if(inside&&block.depth>=middle&&block.depth<far){atomicMin(&depthBounds[2],bitcast<u32>(block.depth));}
 if(inside&&block.depth<=middle&&block.depth>near){atomicMax(&depthBounds[3],bitcast<u32>(block.depth));}
 workgroupBarrier();
 let nearestFar=bitcast<f32>(atomicLoad(&depthBounds[2]));
 let farthestNear=bitcast<f32>(atomicLoad(&depthBounds[3]));
 if(farthest>near&&nearest<far){
  let pixels=vec2f(dfsh.view.xy);
  let first=vec2f(tileId.xy*${DFSH_TILE}u*dfsh.view.z);
  let low=pixelToNdc(first,pixels);
  let high=pixelToNdc(min(first+vec2f(f32(${DFSH_TILE}u*dfsh.view.z)),pixels),pixels);
  let nearHalf=dfshSliceSphere(low,high,nearest,farthestNear);
  let farHalf=dfshSliceSphere(low,high,nearestFar,farthest);
  let culled=objectArgs[1];
  for(var k=lane;k<culled;k+=GATHER_THREADS){
   let object=culledObjects[k];
   let bounds=loadDfObjectBounds(object);
   let centre=dfshFromEye(bounds.center);
   if(dfshSegmentHitsSphere(nearHalf.xyz,dfsh.light.xyz,dfsh.trace.x,centre,bounds.sphereRadius+nearHalf.w)){
    lists[min(atomicAdd(&listCounts[0],1u),GATHER_OBJECTS-1u)]=object;
   }
   if(dfshSegmentHitsSphere(farHalf.xyz,dfsh.light.xyz,dfsh.trace.x,centre,bounds.sphereRadius+farHalf.w)){
    lists[GATHER_OBJECTS+min(atomicAdd(&listCounts[1],1u),GATHER_OBJECTS-1u)]=object;
   }
  }
 }
 workgroupBarrier();
 if(!inside){return;}
 let which=select(0u,1u,block.depth>farthestNear);
 let count=min(atomicLoad(&listCounts[which]),GATHER_OBJECTS);
 var visibility=1.0;
 if(dfshBlockReached(block)&&count>0u){
  let position=dfshPixelPosition(block);
  let density=dfshDensityOf(block.top);
  let rayStart=dfshRayStart(position,block.depth);
  let rayEnd=dfshRayEnd(position);
  for(var k=0u;k<count&&visibility>0.0;k++){
   visibility=dfshTraceObject(lists[which*GATHER_OBJECTS+k],rayStart,rayEnd,dfsh.light.w,visibility,density);
   if(visibility<0.01){visibility=0.0;}
  }
 }
 dfshStore(id.xy,size,visibility,block.depth);
}`,
  [DFSH_COMMON_WGSL, meshFieldWgsl(0, B.objects), DFSH_TRACE_PIXEL_WGSL, DFSH_TRACE_OBJECT_WGSL],
)
