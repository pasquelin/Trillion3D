import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { binScratch } from '../bins/contract.ts'

/** The passes of the cut. */
const PASSES = 2

/**
 * THE VISIBILITY PASSES' WORK BUFFER, one storage buffer the decode, the bins and the deformation
 * read and write, its words laid out here and nowhere else:
 *
 * - the ranges of each pass of the cut (`RANGE`, `RANGE_WORDS` words a pass): the first software
 *   cluster of the pass and how many, the first hardware cluster and how many, as indices in the
 *   list of visible clusters, written by the plan kernel (`decodePlan`) from the list's header;
 * - the instances the hardware slots reserved so far (`INSTANCE_TOTAL`): the main pass's end is where
 *   the post pass's start, so no pass clears it but the first (`decodePlan`);
 * - the deformation's list (`DEFORM`): the number of decoded clusters whose vertices a deformation
 *   moves, the dispatch of the deformation over them, and their indices (`cap` of them);
 * - the bins' scratch (`binScratch`): the counters of a pass, cleared before it.
 */
const RANGE_WORDS = 4
/** The words of a pass's range: the software clusters' first index and count, the hardware
 *  clusters' first index and count. */
const RANGE = { swFirst: 0, swCount: 1, hwFirst: 2, hwCount: 3 } as const
/** The dispatch of the decode and of the bins' count and scatter, one a pass (x, y, z, a spare
 *  word), in a buffer of their own (`DECODE_ARGS_BYTES`): a buffer a dispatch reads its arguments
 *  from may not be bound writable in the same dispatch, and the work buffer is. Written by the plan
 *  kernel (`decodePlan`), which binds it alone. */
const DECODE_ARGS_WORDS = 4
export const DECODE_ARGS_BYTES = PASSES * DECODE_ARGS_WORDS * 4
/** The byte offset of the dispatch of `pass`'s decode in its buffer. */
export const decodeArgsAt = (pass: number) => pass * DECODE_ARGS_WORDS * 4
/** The word behind the ranges that holds the instances the hardware slots reserved. */
const INSTANCE_TOTAL = PASSES * RANGE_WORDS
/** The deformation's words, behind it: the count, the dispatch (x, y, z), then the list. */
export const DEFORM = { at: INSTANCE_TOTAL + 1, count: 0, groups: 1, list: 4 } as const

/** The layout of the work buffer for `slots` bin slots and `cap` visible clusters, in words. */
export function visWorkLayout(slots: number, cap: number) {
  const list = DEFORM.at + DEFORM.list,
    scratch = list + cap,
    bins = binScratch(slots)
  return { list, scratch, bins, words: scratch + bins.words }
}

/** The words the kernels name, as WGSL constants. */
export const VIS_WORK_WGSL = wgslBlock(
  'VIS_WORK_WGSL',
  [],
  wgslConsts({
    RANGE_WORDS,
    RANGE_SW_FIRST: RANGE.swFirst,
    RANGE_SW_COUNT: RANGE.swCount,
    RANGE_HW_FIRST: RANGE.hwFirst,
    RANGE_HW_COUNT: RANGE.hwCount,
    INSTANCE_TOTAL,
    DECODE_ARGS_WORDS,
    DEFORM_COUNT: DEFORM.at + DEFORM.count,
    DEFORM_GROUPS: DEFORM.at + DEFORM.groups,
    DEFORM_LIST: DEFORM.at + DEFORM.list,
  }),
)
