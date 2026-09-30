import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL, VERT_NORMAL_WGSL } from '../visibility/shader/pageWgsl.ts';
import { FLAG_CLUSTER_PAGE, FLAG_DYNAMIC } from '../visibility/types.ts';
import { DEFORM_WGSL } from './deformWgsl.ts';
import { DEFAULT_GROUP_WIDTH } from '../gpu/dag/shader/gridWgsl.ts';

/** One invocation per vertex, one group per resident placement; results share its cache slot. */
export const DEFORMATION_COMPUTE_WGSL = `${PAGE_INFO_STRUCT_WGSL}
@group(0) @binding(0) var<storage,read_write> indices:array<u32>;
@group(0) @binding(1) var<storage,read_write> positions:array<f32>;
@group(0) @binding(2) var<storage,read_write> normals:array<f32>;
@group(0) @binding(3) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(4) var<storage,read> uvs:array<f32>;
@group(0) @binding(5) var<uniform> image:vec4u;
${PAGE_GEOMETRY_WGSL}
${VERT_NORMAL_WGSL}
${DEFORM_WGSL}
fn storeDeformed(at:u32,v:vec3f,whole:bool){
 if(whole){positions[at]=v.x;positions[at+1u]=v.y;positions[at+2u]=v.z;return;}
 indices[at]=bitcast<u32>(v.x);indices[at+1u]=bitcast<u32>(v.y);indices[at+2u]=bitcast<u32>(v.z);
}
@compute @workgroup_size(64)
fn deform(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let row=group.x+group.y*${DEFAULT_GROUP_WIDTH}u;
 if(row>=arrayLength(&pages)){return;}
 let page=pages[row];
 if(page.deformOutput==0u||page.indexCount==0u){return;}
 let h=pageHeader(page);
 for(var v=lane;v<page.deformCount;v+=64u){
  let p=pageRestPosition(page,h,v);
  var n=vec3f(0.0);
  if((page.flags&${FLAG_CLUSTER_PAGE}u)!=0u){n=clusterNormal(h,page.pageOffset,v);}
  else{n=vertN(page.vertexBase,v);}
  let whole=(page.deformOutput&0x80000000u)!=0u;
  let at=(page.deformOutput&0x7fffffffu)-1u+v*11u;
  var before=deformPoint(page,h,v,p,true);
  if(!whole&&(page.flags&${FLAG_DYNAMIC}u)!=0u&&indices[at-2u]==page.selectionIndex+1u){
   if(indices[at-1u]==image.x-1u){before=pageDeformed(page,v,0u);}
   if(indices[at-1u]==image.x){before=pageDeformed(page,v,3u);}
  }
  if(!whole){indices[at-2u]=page.selectionIndex+1u;indices[at-1u]=image.x;}
  storeDeformed(at,deformPoint(page,h,v,p,false),whole);
  storeDeformed(at+3u,before,whole);
  storeDeformed(at+6u,deformNormal(page,h,v,n),whole);
 }
}`;

/** The stage's binding contract, reused by GPU probes. The normals are a range of the position
 *  buffer the stage writes (#1410): a buffer written in a dispatch is read there by no read-only
 *  binding, so they are bound writable too — never written. */
export const deformationBindings = (): GPUBindGroupLayoutEntry[] =>
  Array.from({ length: 6 }, (_, binding) => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: binding === 5 ? 'uniform' : binding <= 2 ? 'storage' : 'read-only-storage' },
  }));
