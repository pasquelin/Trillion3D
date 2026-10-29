import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SV_VOXEL_DATA_WGSL } from './voxelDataWgsl.ts'

/**
 * THE BOXES THE ACCELERATION STRUCTURE OF THE SPARSE VOXELS IS BUILT OVER: for each voxel of the list, the two corners of its box in the volume's
 * local space, six floats, into the position buffer, in the voxel's order. The voxels are the list's counter; the dispatch is rows of 32768
 * groups. Bindings: 0 the parameters, 1 the list's counter (read), 2 the voxels (read), 3 the positions (storage).
 */
export const SV_BLAS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:SvParams;
@group(0) @binding(1) var<storage,read> listCounter:array<u32>;
@group(0) @binding(2) var<storage,read> voxels:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> positions:array<f32>;

@compute @workgroup_size(64)
fn createSparseVoxelBlas(@builtin(global_invocation_id) id:vec3u){
 let at=id.y*SV_ROW_THREADS+id.x;
 if(at>=listCounter[0]){return;}
 let box=svVoxelBounds(voxels[at],params);
 let o=at*6u;
 positions[o]=box[0].x;
 positions[o+1u]=box[0].y;
 positions[o+2u]=box[0].z;
 positions[o+3u]=box[1].x;
 positions[o+4u]=box[1].y;
 positions[o+5u]=box[1].z;
}`,
  [SV_VOXEL_DATA_WGSL],
)
