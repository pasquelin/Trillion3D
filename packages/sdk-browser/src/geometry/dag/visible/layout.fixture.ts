import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { VISIBLE_LAYOUT_WGSL } from './layout.ts'

/** The header and tag words of the list of visible clusters as the shipped kernels read them
 *  (`VISIBLE_LAYOUT_WGSL`): a test names them by the text's own constants, never a copy. */
export const {
  VISIBLE_HEADER_WORDS,
  VIS_SW,
  VIS_HW,
  VIS_SW_SPLIT,
  VIS_HW_SPLIT,
  VIS_ASKED,
  NO_SPLIT,
  VIS_TAG_TESSELLATED,
  VIS_TAG_BLENDED,
} = wgslConstants(VISIBLE_LAYOUT_WGSL)
