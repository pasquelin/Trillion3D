import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SV_VOXEL_DATA_WGSL } from './voxelDataWgsl.ts'

/**
 * THE FIRST STEP OF THE REFINEMENT: over the min texture's first level, each block of 2 x 2 x 2 voxels whose eight are not zero is one voxel
 * of the next level, appended to the list to refine; a block with fewer is appended to the voxel list as the voxels it has. A voxel past the
 * texture's edge is zero.
 * Bindings: 0 the parameters, 1 the min texture, 2 the voxel counter, 3 the voxels, 4 the to-refine counter, 5 the to-refine list.
 */
export const SV_ALLOCATE_TO_REFINE_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:SvParams;
@group(0) @binding(1) var voxelMin:texture_3d<f32>;
@group(0) @binding(2) var<storage,read_write> counter:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> voxels:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> refineCounter:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> toRefine:array<vec2u>;

fn svFilled(cell:vec3u)->bool{
 if(any(cell>=params.resolution)){return false;}
 let value=textureLoad(voxelMin,vec3i(cell),0).xyz;
 return dot(value,value)>0.0;
}

@compute @workgroup_size(4,4,4)
fn allocateSparseVoxelsToRefine(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=params.resolution)||any((id%vec3u(2u))!=vec3u(0u))){return;}
 var filled=0u;
 for(var i=0u;i<8u;i++){
  let offset=vec3u((i&4u)>>2u,(i&2u)>>1u,i&1u);
  if(svFilled(id+offset)){filled++;}
 }
 if(filled==8u){
  // The block is one voxel of the next level, which the refinement goes on with.
  let entry=atomicAdd(&refineCounter[0],1u);
  toRefine[entry]=svEncodeVoxel(id/vec3u(2u),params.mip+1u,params.resolution/vec3u(2u));
 }else if(filled>0u){
  var entry=atomicAdd(&counter[0],filled);
  for(var i=0u;i<8u;i++){
   let offset=vec3u((i&4u)>>2u,(i&2u)>>1u,i&1u);
   if(svFilled(id+offset)){
    voxels[entry]=svEncodeVoxel(id+offset,params.mip,params.resolution);
    entry++;
   }
  }
 }
}`,
  [SV_VOXEL_DATA_WGSL],
)
