import { LEVEL_QUEUES } from './levelWgsl.ts'

/**
 * Each page's last use, written by the GPU: the last camera cut that drew it — the nearest
 * resident ancestor standing in for a missing page included — or requested it.
 *
 * `dagPrepare` counts the camera's cuts in `work` (`dagWorkLayout().frame`), and `dagMask` and
 * `dagWanted` stamp that count, one word per page behind the third descent queue of `flags`.
 * The words outlive the frame: a page not stamped keeps the cut it was last used in, never a
 * cleared flag. The residency cache applies the same rule from the drawn list it reads back
 * (`../../../residency/lastUse.ts`); the eviction queue reads these words (`evictWgsl.ts`).
 *
 * `dagFlagsWords` sizes `flags`: the descent queues, four words per page, and the last-use word
 * per page unless the cut stamps none (`lastUse` false).
 */
export const dagFlagsWords = (queueCap: number, pageCount: number, lastUse = true) =>
  queueCap * LEVEL_QUEUES + pageCount * (lastUse ? 5 : 4)

export const DAG_LAST_USE_WGSL = `fn frameWord()->u32{return drawnGroupsMax()+1u;}
/** Kept list \`l\`'s group count in \`work\`, x then y (0, 1), then the restored journal's (2), then
 *  the descent queues' (3 to 5, \`queueGroups\`): what the arming kernel copies (\`armWgsl.ts\`). */
fn listGroups(l:u32)->u32{return frameWord()+1u+2u*l;}
/** The groups of a list of \`n\`, at least one, written for \`listGroups(l)\`. */
fn armList(l:u32,n:u32){let slice=(max(n,1u)-1u)>>6u;atomicStore(&work[listGroups(l)],gridX(slice));atomicStore(&work[listGroups(l)+1u],gridY(slice));}
fn lastUseAt(i:u32)->u32{return queueBase(${LEVEL_QUEUES}u)+i;}
/** One camera cut more: the clock the pages it uses are stamped with. */
fn countFrame(){atomicAdd(&work[frameWord()],1u);}
/** Page \`i\` is used by this camera cut, drawn or requested: its key's canonical page is stamped
 *  (\`../evict.ts\`). */
fn stampUse(i:u32){setFlag(lastUseAt(coldAt(keyBase()+i)&KEY_PAGE),atomicLoad(&work[frameWord()]));}
`
