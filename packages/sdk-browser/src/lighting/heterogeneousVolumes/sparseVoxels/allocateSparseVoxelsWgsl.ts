import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SV_VOXEL_DATA_WGSL } from './voxelDataWgsl.ts'

/**
 * THE SPARSE VOXELS OF A MIN TEXTURE: every voxel of the texture's first level whose value is not zero is appended to the list.
 * Bindings: 0 the parameters (uniform), 1 the min texture (3D, a half float or float format), 2 the counter (storage), 3 the voxels (storage).
 */
export const SV_ALLOCATE_SPARSE_VOXELS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:SvParams;
@group(0) @binding(1) var voxelMin:texture_3d<f32>;
@group(0) @binding(2) var<storage,read_write> counter:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> voxels:array<vec2u>;

@compute @workgroup_size(4,4,4)
fn allocateSparseVoxels(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=params.resolution)){return;}
 let value=textureLoad(voxelMin,vec3i(id),0).xyz;
 if(dot(value,value)>0.0){
  let entry=atomicAdd(&counter[0],1u);
  voxels[entry]=svEncodeVoxel(id,params.mip,params.resolution);
 }
}`,
  [SV_VOXEL_DATA_WGSL],
)
