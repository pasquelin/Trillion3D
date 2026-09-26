import { LEVEL_QUEUES } from './levelWgsl.ts';

/**
 * Each page's last use, written by the GPU: the last camera cut that drew it — the nearest
 * resident ancestor standing in for a missing page included — or requested it.
 *
 * `dagPrepare` counts the camera's cuts in `work` (`dagWorkLayout().frame`), and `dagMask` and
 * `dagWanted` stamp that count, one word per page behind the third descent queue of `flags`.
 * The words outlive the frame: a page not stamped keeps the cut it was last used in, never a
 * cleared flag. A light cut stamps nothing — its flags are its own and two views may draw one
 * page. The residency cache applies the same rule from the drawn list it reads back
 * (`../../../webgpu/residency/lastUse.ts`); the eviction queue of #478 reads these words.
 */
export const dagFlagsWords = (queueCap: number, pageCount: number) =>
  queueCap * LEVEL_QUEUES + pageCount * 5;

export const DAG_LAST_USE_WGSL = `fn frameWord()->u32{return drawnGroupsMax()+1u;}
fn lastUseAt(i:u32)->u32{return views[0u].queueCap*${LEVEL_QUEUES}u+views[0u].clusterCount*4u+i;}
/** One camera cut more: the clock the pages it uses are stamped with. */
fn countFrame(){if(!isLightCut()){atomicAdd(&work[frameWord()],1u);}}
/** Page \`i\` is used by this camera cut: drawn or requested. */
fn stampUse(i:u32){if(!isLightCut()){flags[lastUseAt(i)]=atomicLoad(&work[frameWord()]);}}
`;
