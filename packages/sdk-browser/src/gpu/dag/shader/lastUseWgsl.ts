import { CAND_LIVE_WORDS, LEVEL_QUEUES } from './levelWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { GROUP_GRID_WGSL } from '../../dispatch/grid.ts'
import { ceilDiv } from '../../../../../math/src/wgsl/integer.ts'

/**
 * Each content key's last use, written by the GPU: the last camera cut that drew a page of it — the
 * nearest resident ancestor standing in for a missing page included — or requested one.
 *
 * `dagPrepare` counts the camera's cuts in `work` (`dagWorkLayout().frame`), and `dagMask` and
 * `dagWanted` stamp that count, one word per key (`../evict.ts`) behind the third descent queue of
 * `flags`. The words outlive the frame: a key not stamped keeps the cut it was last used in, never
 * a cleared flag. The residency cache applies the same rule from the drawn list it reads back
 * (`../../../residency/lastUse.ts`); the eviction queue reads these words (`evictWgsl.ts`).
 *
 * `dagFlagsWords` sizes `flags`: the descent queues, `queueWords` each; the candidates, two words
 * each, and the live list, three, `candCap` of each (`levelWgsl.ts`); the last-use word per key.
 * No word per page.
 */
export const dagFlagsWords = (queueWords: number, candCap: number, keyCount: number) =>
  queueWords * LEVEL_QUEUES + candCap * CAND_LIVE_WORDS + keyCount

export const DAG_LAST_USE_WGSL = wgslBlock(
  'DAG_LAST_USE_WGSL',
  [ceilDiv, GROUP_GRID_WGSL],
  `fn frameWord()->u32{return drawnGroupsMax()+1u;}
/** Kept list \`l\`'s group count in \`work\`, x then y (0, 1), then the restored journal's (2), then
 *  the descent queues' (3 to 5, \`queueGroups\`): what the arming kernel copies (\`armWgsl.ts\`). */
fn listGroups(l:u32)->u32{return frameWord()+1u+2u*l;}
/** The groups of a list of \`n\`, at least one, written for \`listGroups(l)\`. */
fn armList(l:u32,n:u32){let g=groupGrid(ceilDiv(max(n,1u),64u));atomicStore(&work[listGroups(l)],g.x);atomicStore(&work[listGroups(l)+1u],g.y);}
fn lastUseAt(k:u32)->u32{return queueBase(${LEVEL_QUEUES}u)+k;}
/** One camera cut more: the clock the pages it uses are stamped with. */
fn countFrame(){atomicAdd(&work[frameWord()],1u);}
/** Record \`r\` is used by this camera cut, drawn or requested: its content key is stamped
 *  (\`../evict.ts\`). */
fn stampUse(r:u32){setFlag(lastUseAt(keyOf(r)),atomicLoad(&work[frameWord()]));}
`,
)
