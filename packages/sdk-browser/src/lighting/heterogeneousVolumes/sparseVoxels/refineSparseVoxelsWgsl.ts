import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SV_VOXEL_DATA_WGSL } from './voxelDataWgsl.ts'

/**
 * A STEP OF THE REFINEMENT, over one level of the min texture: each voxel of the list to refine (the level's, `params.mip`) looks at its
 * block of 2 x 2 x 2; if the eight are not zero, the voxel with even indices appends the block's parent (the next level) to the list, the
 * others stand aside; else the voxel is final. The list's entries are its counter's; the dispatch is rows of 32768 groups
 * (SV_ROW_THREADS threads a row).
 * Bindings: 0 the parameters, 1 the min texture (this level, `resolution` its size), 2 the list's counter (read), 3 the list (read),
 * 4 the next list's counter, 5 the next list, 6 the voxel counter, 7 the voxels.
 */
export const SV_REFINE_SPARSE_VOXELS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:SvParams;
@group(0) @binding(1) var voxelMin:texture_3d<f32>;
@group(0) @binding(2) var<storage,read> listCounter:array<u32>;
@group(0) @binding(3) var<storage,read> toRefine:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> nextCounter:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> nextToRefine:array<vec2u>;
@group(0) @binding(6) var<storage,read_write> counter:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> voxels:array<vec2u>;

@compute @workgroup_size(64)
fn refineSparseVoxels(@builtin(global_invocation_id) id:vec3u){
 let at=id.y*SV_ROW_THREADS+id.x;
 if(at>=listCounter[0]){return;}
 let voxel=svDecodeVoxel(toRefine[at],params.volumeResolution);
 let aligned=(voxel/vec3u(2u))*vec3u(2u);
 var allFilled=true;
 for(var i=0u;i<8u;i++){
  let offset=vec3u((i&4u)>>2u,(i&2u)>>1u,i&1u);
  let cell=aligned+offset;
  if(any(cell>=params.resolution)){allFilled=false;continue;}
  let value=textureLoad(voxelMin,vec3i(cell),0).xyz;
  if(dot(value,value)<=0.0){allFilled=false;}
 }
 if(allFilled){
  // The even voxel of a block carries it up; the aligned one adds the parent.
  if(any((voxel%vec3u(2u))!=vec3u(0u))){return;}
  let entry=atomicAdd(&nextCounter[0],1u);
  nextToRefine[entry]=svEncodeVoxel(voxel/vec3u(2u),params.mip+1u,params.resolution/vec3u(2u));
 }else{
  let entry=atomicAdd(&counter[0],1u);
  voxels[entry]=toRefine[at];
 }
}`,
  [SV_VOXEL_DATA_WGSL],
)

/**
 * THE END OF THE REFINEMENT: the voxels still on the list once the last level of the min texture is read are final, their block filled all the
 * way up. Each is appended to the voxel list. Bindings: 0 the parameters, 1 the list's counter (read), 2 the list (read), 3 the voxel counter,
 * 4 the voxels.
 */
export const SV_FLUSH_REFINED_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:SvParams;
@group(0) @binding(1) var<storage,read> listCounter:array<u32>;
@group(0) @binding(2) var<storage,read> toRefine:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> counter:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> voxels:array<vec2u>;

@compute @workgroup_size(64)
fn flushRefinedVoxels(@builtin(global_invocation_id) id:vec3u){
 let at=id.y*SV_ROW_THREADS+id.x;
 if(at>=listCounter[0]){return;}
 let entry=atomicAdd(&counter[0],1u);
 voxels[entry]=toRefine[at];
}`,
  [SV_VOXEL_DATA_WGSL],
)
