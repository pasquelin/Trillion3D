import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { VIS_WORK_WGSL } from './contract.ts'

/** The work buffer's words as the shipped kernels read them (`VIS_WORK_WGSL`): a test lays the
 *  buffer by the text's own constants, never a copy. */
const words = wgslConstants(VIS_WORK_WGSL)

export const RANGE_WORDS = words.RANGE_WORDS,
  DECODE_ARGS_WORDS = words.DECODE_ARGS_WORDS,
  INSTANCE_TOTAL = words.INSTANCE_TOTAL
/** The words of a pass's range: the software clusters' first index and count, the hardware
 *  clusters' first index and count. */
export const RANGE = {
  swFirst: words.RANGE_SW_FIRST,
  swCount: words.RANGE_SW_COUNT,
  hwFirst: words.RANGE_HW_FIRST,
  hwCount: words.RANGE_HW_COUNT,
} as const
