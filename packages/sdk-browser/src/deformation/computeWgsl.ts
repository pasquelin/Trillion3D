import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../visibility/shader/pageWgsl.ts'

/** The stage's bindings, named once: the text and the layout print them. `normals` is the float
 *  pool's normal atlas (`../gpu/core/floatAtlas.ts`); `pages` the rows deformed, the page table
 *  or the float-pool blocks' (`../deformation/pooledRows.ts`); `image` the dispatch's record. */
export const DEFORMATION_BINDING = {
  indices: 0,
  positions: 1,
  normals: 2,
  pages: 3,
  uvs: 4,
  image: 5,
} as const
const B = DEFORMATION_BINDING
import { DEFORM_ADDRESS, FLAG_CLUSTER_PAGE, FLAG_DYNAMIC, FLAG_VOXEL } from '../visibility/types.ts'
import { DEFORM_WGSL } from './deformWgsl.ts'
import { DEFORM_TAG_WORDS, DEFORM_VERTEX_WORDS, DEFORMED_FIELD } from './outputs.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'

/** One invocation per vertex, one group per resident placement; its results lie in the float pool. */
export const DEFORMATION_COMPUTE_WGSL = wgslProgram(
  `@group(0) @binding(${B.indices}) var<storage,read_write> indices:array<u32>;
@group(0) @binding(${B.positions}) var<storage,read_write> positions:array<f32>;
@group(0) @binding(${B.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${B.uvs}) var<storage,read> uvs:array<f32>;
/** x the image number, y the rows this dispatch deforms: a padding group of its last row leaves. */
@group(0) @binding(${B.image}) var<uniform> image:vec4u;
fn storeDeformed(at:u32,v:vec3f){positions[at]=v.x;positions[at+1u]=v.y;positions[at+2u]=v.z;}
/** A tag as a vertex's results keep it: its low 24 bits, which a float carries exactly. */
fn deformTagOf(tag:u32)->u32{return tag&0xffffffu;}
fn deformTag(at:u32)->u32{return u32(positions[at]);}
fn storeTag(at:u32,tag:u32){positions[at]=f32(deformTagOf(tag));}
@compute @workgroup_size(WORKGROUP_THREADS)
fn deform(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let row=flatIndex(group,groups,1u);
 if(row>=min(image.y,arrayLength(&pages))){return;}
 let page=pages[row];
 if(page.deformOutput==0u||page.indexCount==0u){return;}
 let h=pageHeader(page);
 for(var v=lane;v<page.deformCount;v+=WORKGROUP_THREADS){
  let p=pageRestPosition(page,h,v);
  var n=vec3f(0.0);
  if((page.flags&${FLAG_CLUSTER_PAGE}u)!=0u){n=clusterNormal(h,page.pageOffset,v);}
  else if((page.flags&${FLAG_VOXEL}u)!=0u){n=voxelVertexNormal(page.pageOffset,v);}
  else{n=vertN(page.vertexBase,v);}
  let at=(page.deformOutput&${DEFORM_ADDRESS}u)-1u+v*${DEFORM_VERTEX_WORDS}u;
  let tags=at-${DEFORM_TAG_WORDS}u;
  var before=deformVertex(page,h,v,p,n,true).p;
  if((page.flags&${FLAG_DYNAMIC}u)!=0u&&deformTag(tags)==deformTagOf(page.selectionIndex+1u)){
   let last=deformTag(tags+1u);
   if(last==deformTagOf(image.x-1u)){before=pageDeformed(page,v,${DEFORMED_FIELD.position}u);}
   if(last==deformTagOf(image.x)){before=pageDeformed(page,v,${DEFORMED_FIELD.previous}u);}
  }
  storeTag(tags,page.selectionIndex+1u);storeTag(tags+1u,image.x);
  let now=deformVertex(page,h,v,p,n,false);
  storeDeformed(at+${DEFORMED_FIELD.position}u,now.p);
  storeDeformed(at+${DEFORMED_FIELD.previous}u,before);
  storeDeformed(at+${DEFORMED_FIELD.normal}u,now.n);
 }
}`,
  [
    PAGE_INFO_STRUCT_WGSL,
    normalAtlasWgsl(B.normals),
    PAGE_GEOMETRY_WGSL,
    DEFORM_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ],
)

/** The stage's layout, each binding at its name's (`DEFORMATION_BINDING`), as the text declares it. */
export const deformationBindings = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.indices, 'storage'),
  computeBufferEntry(B.positions, 'storage'),
  computeTextureEntry(B.normals, 'unfilterable-float', '2d-array'),
  computeBufferEntry(B.pages, 'read-only-storage'),
  computeBufferEntry(B.uvs, 'read-only-storage'),
  computeUniformEntry(B.image),
]
