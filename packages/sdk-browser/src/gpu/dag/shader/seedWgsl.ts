import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { AHEAD_VIEW } from './aheadWgsl.ts'

/** The view bits a candidate's entry takes once its page is asked for (`DAG_SEED_WGSL`): past
 *  every view a cut runs (`AHEAD_VIEW` the last), within the entry's five view bits. */
const ROW_SEED_ASKED = AHEAD_VIEW + 1,
  ROW_SEED_AHEAD = AHEAD_VIEW + 2

/**
 * THE SEEDS OF THE ROWS' CLOSURE (#1527): the pages a cut drew, asked for, or asked for ahead, each
 * with its placement, where the stamps of the pool's last uses already know them
 * (`lastUseWgsl.ts`). A drawn page is a live entry whose draw bit `dagMask` set — the live list
 * keeps its placement —; a page asked for is a candidate `dagWanted` requested, its entry's view
 * bits then marking it asked, or asked ahead (`markSeed`): no list, no counter, no word more, and
 * every request a seed whatever the readback's cap. A candidate's entry is read by `dagWanted`
 * alone before the mark, its view no more after it. The closure kernel walks both lists
 * (`../../../webgpu/row/rowClosureWgsl.ts`).
 */
export const DAG_SEED_WGSL = wgslBlock(
  'DAG_SEED_WGSL',
  [],
  `${wgslConsts({ ROW_SEED_ASKED, ROW_SEED_AHEAD })}
/** The candidate \`dagWanted\` reads. */
var<private> wantedAt:u32;
/** The candidate \`dagWanted\` reads was asked for, \`kind\` saying how: its entry's view bits. */
fn markSeed(kind:u32){let at=candBase()+2u*wantedAt;setFlag(at,packEntry(kind,entryIndex(flagAt(at))));}
`,
)
