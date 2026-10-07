import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../visibility/shader/pageWgsl.ts'

/** The binding of the float pool's normal atlas (`../webgpu/core/floatAtlas.ts`). */
export const DEFORMATION_NORMALS = 2
import {
  DEFORM_ADDRESS,
  DEFORM_IN_POOL,
  FLAG_CLUSTER_PAGE,
  FLAG_DYNAMIC,
} from '../visibility/types.ts'
import { DEFORM_WGSL } from './deformWgsl.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'

/** Lanes of the stage's group: a row of at most as many vertices deforms them in one pass. */
export const DEFORMATION_LANES = 64

/** One invocation per vertex, one group per resident placement; results share its cache slot. */
export const DEFORMATION_COMPUTE_WGSL = `${PAGE_INFO_STRUCT_WGSL}
@group(0) @binding(0) var<storage,read_write> indices:array<u32>;
@group(0) @binding(1) var<storage,read_write> positions:array<f32>;
${normalAtlasWgsl(DEFORMATION_NORMALS)}
@group(0) @binding(3) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(4) var<storage,read> uvs:array<f32>;
/** x the image number, y the rows this dispatch deforms: a padding group of its last row leaves. */
@group(0) @binding(5) var<uniform> image:vec4u;
${PAGE_GEOMETRY_WGSL}
${DEFORM_WGSL}
fn storeDeformed(at:u32,v:vec3f,whole:bool){
 if(whole){positions[at]=v.x;positions[at+1u]=v.y;positions[at+2u]=v.z;return;}
 indices[at]=bitcast<u32>(v.x);indices[at+1u]=bitcast<u32>(v.y);indices[at+2u]=bitcast<u32>(v.z);
}
/** A tag as a vertex's results keep it: a word in a slot's tail; in the float pool, its low 24
 *  bits, which a float carries exactly. */
fn deformTagOf(tag:u32,whole:bool)->u32{return select(tag,tag&0xffffffu,whole);}
fn deformTag(at:u32,whole:bool)->u32{
 if(whole){return u32(positions[at]);}return indices[at];
}
fn storeTag(at:u32,tag:u32,whole:bool){
 if(whole){positions[at]=f32(deformTagOf(tag,true));return;}indices[at]=tag;
}
${FLAT_INDEX_WGSL}@compute @workgroup_size(${DEFORMATION_LANES})
fn deform(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let row=flatIndex(group,groups,1u);
 if(row>=min(image.y,arrayLength(&pages))){return;}
 let page=pages[row];
 if(page.deformOutput==0u||page.indexCount==0u){return;}
 let h=pageHeader(page);
 for(var v=lane;v<page.deformCount;v+=${DEFORMATION_LANES}u){
  let p=pageRestPosition(page,h,v);
  var n=vec3f(0.0);
  if((page.flags&${FLAG_CLUSTER_PAGE}u)!=0u){n=clusterNormal(h,page.pageOffset,v);}
  else{n=vertN(page.vertexBase,v);}
  let whole=(page.deformOutput&${DEFORM_IN_POOL}u)!=0u;
  // A whole copy keeps no tags; a slot's tail and a float page's block do.
  let tagged=!deformWholeCopy(page);
  let at=(page.deformOutput&${DEFORM_ADDRESS}u)-1u+v*11u;
  var before=deformPoint(page,h,v,p,true);
  if(tagged&&(page.flags&${FLAG_DYNAMIC}u)!=0u&&deformTag(at-2u,whole)==deformTagOf(page.selectionIndex+1u,whole)){
   let last=deformTag(at-1u,whole);
   if(last==deformTagOf(image.x-1u,whole)){before=pageDeformed(page,v,0u);}
   if(last==deformTagOf(image.x,whole)){before=pageDeformed(page,v,3u);}
  }
  if(tagged){storeTag(at-2u,page.selectionIndex+1u,whole);storeTag(at-1u,image.x,whole);}
  storeDeformed(at,deformPoint(page,h,v,p,false),whole);
  storeDeformed(at+3u,before,whole);
  storeDeformed(at+6u,deformNormal(page,h,v,n),whole);
 }
}`

/** The stage's binding contract, reused by GPU probes: buffers, the normal atlas at its rank. */
export const deformationBindings = (): GPUBindGroupLayoutEntry[] =>
  Array.from({ length: 6 }, (_, binding) => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    ...(binding === DEFORMATION_NORMALS
      ? { texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } as const }
      : {
          buffer: {
            type: binding === 5 ? 'uniform' : binding <= 1 ? 'storage' : 'read-only-storage',
          } as const,
        }),
  }))
