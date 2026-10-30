import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { MASK_WORD } from '../../rays/sceneTrace/sceneMaskWgsl.ts'

/**
 * `stMaterialWordOf`: where in the scene trace's table begin the material words of a hit met through the placement `placement` in the record `record` — the one resolver of every per-hit material read
 * (the hit lighting's material and shadow rays, the traced translucency's path): the placement's words, or an HLOD actor's own (`stMaskWord`). `NO_INDEX` for an actor's record that names no material.
 */
export const TRACED_MATERIAL_WORD_WGSL = wgslBlock(
  'TRACED_MATERIAL_WORD_WGSL',
  [MASK_WORD],
  `fn stMaterialWordOf(placement:u32,record:u32)->u32{return stMaskWord(placement,record,stTable[record*ST_RECORD_WORDS+ST_RECORD_FLAGS]);}`,
)
