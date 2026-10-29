import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'

/**
 * THE BITMASK OF THE TOP LEVEL: one bit for each non-empty top-level cell, the cells of a block of 4 x 4 x 4 gathered in the two words of
 * one entry, the bit placed by the Morton order of the cell inside the block and the entry by the Morton order of the block. One
 * dispatch over the blocks; the entry buffer is cleared before, and holds the Morton extent of the blocks (the cube of the next
 * power of two over the most blocks along a side), which a Morton index of a block never leaves.
 *
 * Bindings: 0 the resolution of the top level (uniform), 1 the top-level cells (storage, read), 2 the entries (storage).
 */
export const VG_TOP_LEVEL_BITMASK_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> resolution:vec4i;
@group(0) @binding(1) var<storage,read> topLevel:array<u32>;
@group(0) @binding(2) var<storage,read_write> bitmask:array<atomic<u32>>;

@compute @workgroup_size(4,4,4)
fn topLevelCreateBitmask(
 @builtin(global_invocation_id) id:vec3u,
 @builtin(local_invocation_id) inBlock:vec3u,
 @builtin(workgroup_id) block:vec3u){
 if(any(vec3i(id)>=resolution.xyz)){return;}
 if(vgIsBottomEmpty(topLevel[vgLinearIndex(id,resolution.xyz)])){return;}
 let bit=mortonEncode3(inBlock);
 let entry=mortonEncode3(block)*2u;
 // Bits 0..31 live in the first word, 32..63 in the second.
 atomicOr(&bitmask[entry+(bit>>5u)],1u<<(bit&31u));
}`,
  [VG_TYPES_WGSL],
)

/** The entries the bitmask buffer holds for a top level of `resolution` cells: the Morton extent of its 4-cell blocks. */
export function topLevelBitmaskEntries(resolution: readonly [number, number, number]) {
  const blocks = Math.max(...resolution.map((n) => Math.ceil(n / 4)))
  const side = 2 ** Math.ceil(Math.log2(blocks))
  return side ** 3
}
