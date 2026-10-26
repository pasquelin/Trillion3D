import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitIsSet, bitWord } from '../../../../../math/src/wgsl/integer.ts'

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
