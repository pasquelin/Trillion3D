import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitAt, bitWord } from '../../../../../math/src/wgsl/integer.ts'

/**
 * The cut's draw mask, a bit a packed page (`compactWgsl.ts`): whether the mask the host binds as
 * `selectionMask`, behind `uni.selectionOffset`, holds the bit of `index`. The host declares both.
 */
export const DRAW_MASK_WGSL = wgslBlock(
  'DRAW_MASK_WGSL',
  [bitWord, bitAt],
  'fn maskSelects(index:u32)->bool{return bitAt(selectionMask[uni.selectionOffset+bitWord(index)],index)!=0u;}',
)
