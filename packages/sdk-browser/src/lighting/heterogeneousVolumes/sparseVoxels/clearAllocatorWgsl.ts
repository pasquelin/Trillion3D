import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'

/** THE COUNTER OF A VOXEL LIST CLEARED: its one word to zero. Binding 0: the counter (storage). */
export const SV_CLEAR_ALLOCATOR_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> counter:array<u32>;
@compute @workgroup_size(1)
fn clearAllocator(){counter[0]=0u;}`,
  [],
)
