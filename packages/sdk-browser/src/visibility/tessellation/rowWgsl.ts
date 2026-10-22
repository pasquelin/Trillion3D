import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import {
  FLAG_DISPLACED,
  FLAG_DYNAMIC,
  FLAG_LINE,
  FLAG_MASK,
  FLAG_SPRITE,
  FLAG_VOXEL,
} from '../types.ts'

/** The flags of a row the tessellation leaves as it is: a line, a sprite, a voxel brick, a
 *  geometry the host rewrites in place and a masked surface, whose cutout the micro-triangles do not
 *  read. */
const UNTESSELLATED = FLAG_LINE | FLAG_SPRITE | FLAG_VOXEL | FLAG_DYNAMIC | FLAG_MASK

/**
 * Whether the frame tessellates a row (`page`, a row of the page table; `uni`, the visibility
 * uniform): its surface names a displacement whose height map the atlas holds
 * (`FLAG_DISPLACED`), the `tessellation` setting is on (`uni.tessellation`), and it is none of the
 * rows above, nor deformed by a skin or a morph (`deformOutput`). The one test the split of the
 * rasters (`../raster/binWgsl.ts`) and the seeding of the patches (`seedWgsl.ts`) both make of a
 * drawn row, so that every row the first leaves out the second takes.
 */
export const TESSELLATED_ROW_WGSL = wgslFn(
  'tessellatedRow',
  [],
  `fn tessellatedRow(page:PageInfo)->bool{
 return uni.tessellation!=0u&&(page.flags&${FLAG_DISPLACED}u)!=0u&&(page.flags&${UNTESSELLATED}u)==0u&&page.deformOutput==0u;
}`,
)
