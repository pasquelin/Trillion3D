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
fn lastUseAt(i:u32)->u32{return queueBase(${LEVEL_QUEUES}u)+i;}
/** One camera cut more: the clock the pages it uses are stamped with. */
fn countFrame(){atomicAdd(&work[frameWord()],1u);}
/** Page \`i\` is used by this camera cut, drawn or requested: its key's canonical page is stamped
 *  (\`../evict.ts\`). */
fn stampUse(i:u32){setFlag(lastUseAt(coldAt(keyBase()+i)&KEY_PAGE),atomicLoad(&work[frameWord()]));}
`
