import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitIsSet, bitMask, bitWord, ceilDivWgsl } from '../../../../../math/src/wgsl/integer.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'

/**
 * The cut's mask of blended clusters, a bit a packed page (`blendMaskWgsl.ts`): whether the mask the
 * host binds as `selectionMask`, behind `uni.selectionOffset`, holds the bit of `index`. The host
 * declares both.
 */
export const DRAW_MASK_WGSL = wgslBlock(
  'DRAW_MASK_WGSL',
  [bitWord, bitIsSet],
  'fn maskSelects(index:u32)->bool{return bitIsSet(selectionMask[uni.selectionOffset+bitWord(index)],index);}',
)

/**
 * The access to a cut's mask of pages, a bit a packed page, whatever the mask's place in `work`: the blocks of `WORKGROUP_THREADS`
 * pages the cut holds (`blockCount`), the word of the mask that holds page `i`'s bit from the host's `drawMaskBase()` (`drawMaskWord`)
 * and that bit (`drawBit`). The host declares `cutView` and `drawMaskBase`, where its layout puts the mask.
 */
export const DRAW_MASK_ACCESS_WGSL = wgslBlock(
  'DRAW_MASK_ACCESS_WGSL',
  [ceilDivWgsl, bitWord, bitMask, WORKGROUP_THREADS_WGSL],
  `fn blockCount()->u32{return ceilDiv(cutView.clusterCount,WORKGROUP_THREADS);}
fn drawMaskWord(i:u32)->u32{return drawMaskBase()+bitWord(i);}
fn drawBit(i:u32)->u32{return bitMask(i);}`,
)
