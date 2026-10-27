import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { REJECT_SHADING_STRIDE, REJECT_SHADING_TILE } from './rejectionNetworkWgsl.ts'

/** The texels of a workgroup's tile of the shading rejection. */
const TILE_CELLS = REJECT_SHADING_TILE * REJECT_SHADING_TILE

/** The planes of the flicker measure's output: the error the rejection widens by, and the count
 *  only the flicker analysis view shows. */
export const FLICKER_PLANES = { error: 0, count: 1 } as const

/** The words of the flicker measure's output for render targets of `width × height`: each plane a
 *  tile of cells to each workgroup of the shading rejection's dispatch (the grid its stride makes of
 *  the render texels), 32 bits a cell, so a half-float value and a 32-bit one are both kept as they
 *  were. The count's plane is there `counted`, while an analysis view is shown: the error's alone
 *  else. */
export const flickerErrorWords = (width: number, height: number, counted: boolean) =>
  (counted ? Object.keys(FLICKER_PLANES).length : 1) *
  ceilDiv(width, REJECT_SHADING_STRIDE) *
  ceilDiv(height, REJECT_SHADING_STRIDE) *
  TILE_CELLS

/**
 * The cell of the flicker measure's output for the lane's texel at column `x`, row `row` of the tile
 * of workgroup `wg` in a dispatch of `groups` workgroups, in `plane` (`FLICKER_PLANES`): a tile of
 * the shading rejection's texels a workgroup, the texels it reads beside the ones it writes included
 * — the measure's values there are those its own tile's network gave them, which no other
 * workgroup's tile shares — so the shading rejection reads, at each texel of its tile, what the
 * measure computed at that texel of the same tile.
 */
export const FLICKER_CELL_WGSL = wgslBlock(
  'FLICKER_CELL_WGSL',
  [],
  `
fn flickerCell(wg:vec3u,groups:vec3u,row:i32,x:i32,plane:u32)->u32{
 return plane*groups.x*groups.y*${TILE_CELLS}u+(wg.y*groups.x+wg.x)*${TILE_CELLS}u+u32(row*${REJECT_SHADING_TILE}+x);
}`,
)
