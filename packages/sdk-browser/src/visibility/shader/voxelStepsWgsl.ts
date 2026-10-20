import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SHADE_BINDINGS } from '../../webgpu/core/bindLayout.ts'

/**
 * WHAT THE VOXEL TRACE COSTS, counted by the resolve of the voxel classes alone (`VOXEL`, folded
 * out of every other class) on a sampled frame alone (`uni.voxelCounting`, `voxelSteps.ts`): one
 * pixel in 64 — an 8 × 8 lattice of the screen — adds itself and its DDA steps, and raises the most
 * steps a pixel took. Three atomics a counted pixel, on one sampled frame in fifteen; the others
 * pay a uniform's branch.
 */
export const VOXEL_STEPS_WGSL = wgslBlock(
  'VOXEL_STEPS_WGSL',
  [],
  `@group(0) @binding(${SHADE_BINDINGS.voxelSteps}) var<storage,read_write> voxelSteps:array<atomic<u32>,4>;
fn voxelStepsTally(pos:vec2f,steps:u32){
 if(any((vec2u(pos)&vec2u(7u))!=vec2u(0u))){return;}
 atomicAdd(&voxelSteps[0],1u);atomicAdd(&voxelSteps[1],steps);atomicMax(&voxelSteps[2],steps);
}`,
)
