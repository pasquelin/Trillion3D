import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import {
  VSM_COUNTERS,
  VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS,
  VSM_OVERFLOW_PAGE_POOL,
  VSM_OVERFLOW_RECORDS,
  VSM_OVERFLOW_VISIBLE_INSTANCES,
} from './constants.ts'

/** The stats buffer's overflow flags word and its bits, as a shader names them
 *  (`VSM_OVERFLOW_FLAGS`, the word after the counters, `VSM_OVERFLOW_*`): a pass that cannot hold what a frame asks of it sets
 *  its bit with an atomic or, whatever the counters say. */
export const VSM_OVERFLOW_WGSL = wgslBlock(
  'VSM_OVERFLOW_WGSL',
  [],
  wgslConsts({
    VSM_OVERFLOW_FLAGS: VSM_COUNTERS,
    VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS,
    VSM_OVERFLOW_PAGE_POOL,
    VSM_OVERFLOW_RECORDS,
    VSM_OVERFLOW_VISIBLE_INSTANCES,
  }),
)
