import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_DISPLACED, FLAG_LINE, FLAG_SPRITE, FLAG_VOXEL } from '../types.ts'

/** The flags of a row the tessellation leaves as it is: a line, a sprite, a voxel brick. A masked
 *  surface is tessellated, its cutout read at the micro-triangles' vertices; so is a row a skin or a
 *  morph moves, or the host rewrites in place: its corners are read as this frame deforms them
 *  (`pagePosition`, `pageNormal`). */
export const UNTESSELLATED = FLAG_LINE | FLAG_SPRITE | FLAG_VOXEL

/**
 * Whether a row is one the tessellation can draw (`page`, a row of the page table): its surface
 * names a displacement whose height map the atlas holds (`FLAG_DISPLACED`), and it is none of the
 * rows above. The part of the test that is the row's alone, which the resolve repeats on its own
 * uniform (`prismWgsl.ts`).
 */
export const TESSELLATED_FLAGS_WGSL = wgslFn(
  'tessellatedFlags',
  [],
  `fn tessellatedFlags(page:PageInfo)->bool{
 return (page.flags&${FLAG_DISPLACED}u)!=0u&&(page.flags&${UNTESSELLATED}u)==0u;
}`,
)
