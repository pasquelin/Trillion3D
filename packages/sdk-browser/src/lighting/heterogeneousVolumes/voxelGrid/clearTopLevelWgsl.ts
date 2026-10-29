import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'

/**
 * THE TOP LEVEL OF A GRID CLEARED to 0xFFFFFFF8: no bottom-level index (the empty one), no cells along a side. One thread a word, over
 * the binding's whole range, 256 groups wide (16384 words a row) so that no dispatch passes 65535 groups. Binding 0: the top-level cells
 * (storage).
 */

/** The words one row of the clear's dispatch holds. */
export const VG_CLEAR_ROW_WORDS = 256 * 64
export const VG_CLEAR_TOP_LEVEL_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> topLevel:array<u32>;
@compute @workgroup_size(64)
fn clearTopLevel(@builtin(global_invocation_id) id:vec3u){
 let at=id.y*16384u+id.x;
 if(at<arrayLength(&topLevel)){topLevel[at]=0xFFFFFFF8u;}
}`,
  [],
)
