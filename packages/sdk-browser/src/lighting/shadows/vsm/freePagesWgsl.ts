/**
 * THE SHADOW POOL'S PAGE LISTS (#1527): four persistent lists of physical pages, each `poolPages`
 * entries and a count, in the one buffer `vsmFreePages` (list `l` starts at word `l · (poolPages + 1)`,
 * its count in the last word of its slice):
 *
 * - `PM_LIST_LRU`: the pool in the order of last frame's `PM_LIST_REQUESTED`; the keep rule
 *   (`vsmKeepPages`, a thread a list entry) writes it back with the pages it took out marked `PM_NONE`.
 * - `PM_LIST_AVAILABLE`: the LRU list packed (`vsmPackAvailable`, order kept), the empty pages
 *   appended (`vsmAppendCopy`); a page request takes the last entry (`pmPop`): an empty page first,
 *   then the page at the end of last frame's order.
 * - `PM_LIST_EMPTY`: the pages the keep rule left with no word, until they join the available ones.
 * - `PM_LIST_REQUESTED`: the pages asked this frame, then the pages a request took, then, at the
 *   frame's end (`vsmAppendCopy`), the available pages left: next frame's LRU order.
 *
 * The buffer is doubled by the frame set (`VsmFrameBuffers.freePages`): `vsmPrevFreePages` is last frame's.
 */
import { LANE_SCAN_WGSL, laneRunOffsets } from '../../../gpu/core/laneScanWgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_PAGE_LIST } from './constants.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/** The lists and what moves a page between them, over the atomic words of `vsmFreePages`. A count is
 *  read signed: a pop that finds the available list empty leaves its count below zero, the pages the
 *  requests fell short of (`pmFreeCount`, the feedback's). */
export const VSM_FREE_PAGES_WGSL = wgslBlock(
  'VSM_FREE_PAGES_WGSL',
  [VSM_CONSTANTS_WGSL],
  `${wgslConsts({
    PM_LIST_LRU: VSM_PAGE_LIST.lru,
    PM_LIST_AVAILABLE: VSM_PAGE_LIST.available,
    PM_LIST_EMPTY: VSM_PAGE_LIST.empty,
    PM_LIST_REQUESTED: VSM_PAGE_LIST.requested,
  })}
/** An entry of the LRU list the keep rule took out. */
const PM_NONE:u32=0xffffffffu;
/** The word of entry \`k\` of list \`list\`; entry \`poolPages\` is its count. */
fn pmListAt(list:u32,k:u32)->u32{return list*(vsm.poolPages+1u)+k;}
fn pmListItem(list:u32,k:u32)->u32{return atomicLoad(&vsmFreePages[pmListAt(list,k)]);}
fn pmListSet(list:u32,k:u32,page:u32){atomicStore(&vsmFreePages[pmListAt(list,k)],page);}
fn pmListCount(list:u32)->i32{return bitcast<i32>(atomicLoad(&vsmFreePages[pmListAt(list,vsm.poolPages)]));}
fn pmListSetCount(list:u32,count:i32){atomicStore(&vsmFreePages[pmListAt(list,vsm.poolPages)],bitcast<u32>(count));}
/** Adds \`page\` to the end of \`list\`; a full list takes no more and its count stays at \`poolPages\` (the
 *  push that found it full gives its place back), so a pop never reads the count word or the next list as a page. */
fn pmPush(list:u32,page:u32){
 let at=atomicAdd(&vsmFreePages[pmListAt(list,vsm.poolPages)],1u);
 if(at<vsm.poolPages){pmListSet(list,at,page);}
 else{atomicSub(&vsmFreePages[pmListAt(list,vsm.poolPages)],1u);}
}
/** Takes the last page of \`list\`: < 0 when none is left, its count then below zero. */
fn pmPop(list:u32)->i32{
 let at=bitcast<i32>(atomicSub(&vsmFreePages[pmListAt(list,vsm.poolPages)],1u))-1i;
 if(at<0i){return -1i;}
 return i32(pmListItem(list,u32(at)));
}
/** The available pages left less the requests none was left for: below zero when the pool fell short. */
fn pmFreeCount()->i32{return pmListCount(PM_LIST_AVAILABLE);}
`,
)

/** The page lists' passes: the lists reset (\`vsmInitPageLists\`), the LRU list packed into the
 *  available one (\`vsmPackAvailable\`), the empty list and then, after the grant, the available list
 *  appended (\`vsmAppendCopy\` and \`vsmAppendCounts\`, which lists by \`vsmPm\`). */
export const VSM_PAGE_LISTS_WGSL = wgslBlock(
  'VSM_PAGE_LISTS_WGSL',
  [LANE_SCAN_WGSL, VSM_FREE_PAGES_WGSL, VSM_CONSTANTS_WGSL],
  `/** The lists at the frame's start: the LRU list full, the others empty. */
@compute @workgroup_size(1)
fn vsmInitPageLists(){
 pmListSetCount(PM_LIST_LRU,i32(vsm.poolPages));
 pmListSetCount(PM_LIST_AVAILABLE,0i);
 pmListSetCount(PM_LIST_EMPTY,0i);
 pmListSetCount(PM_LIST_REQUESTED,0i);
}
/** 1 when entry \`g\` of the LRU list was left in by the keep rule. */
fn pmPackKept(g:u32)->u32{return select(1u,0u,pmListItem(PM_LIST_LRU,g)==PM_NONE);}
/** Entry \`g\` of the LRU list, when it was left in (\`taken\` 1), goes to place \`cursor\` of the available list. */
fn pmPackPlace(g:u32,cursor:u32,taken:u32){
 if(taken!=0u){pmListSet(PM_LIST_AVAILABLE,cursor,pmListItem(PM_LIST_LRU,g));}
}
/** The LRU list packed into the available one by a prefix sum, one group: the entries left in keep
 *  their order. */
@compute @workgroup_size(WORKGROUP_THREADS)
fn vsmPackAvailable(@builtin(local_invocation_index) lane:u32){
 let span=laneRun(lane,vsm.poolPages);
 ${laneRunOffsets('g', 'span', 'lane', '', 'pmPackKept(g)', 'pmPackPlace(g,cursor,taken)')}
 // The last lane's cursor ends past every entry: the packed count.
 if(lane==WORKGROUP_THREADS-1u){pmListSetCount(PM_LIST_AVAILABLE,i32(cursor));}
}
/** What an append moves: the input list's entries, as many as the output list has room for. */
fn pmAppendRoom(input:u32,output:u32)->u32{
 return u32(max(0i,min(pmListCount(input),i32(vsm.poolPages)-pmListCount(output))));
}
/** Thread \`thread\` of the copy: input entry \`thread\` after the output list's entries. */
fn pmAppendItem(input:u32,output:u32,thread:u32){
 if(thread<pmAppendRoom(input,output)){
  pmListSet(output,u32(pmListCount(output))+thread,pmListItem(input,thread));
 }
}
/** The counts after the copy: the output list longer by what moved, the input list empty. */
fn pmAppendCounts(input:u32,output:u32){
 pmListSetCount(output,pmListCount(output)+i32(pmAppendRoom(input,output)));
 pmListSetCount(input,0i);
}
/** The copy from the list \`vsmPm.appendFrom\` to the list \`vsmPm.appendTo\`. */
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmAppendCopy(@builtin(global_invocation_id) id:vec3u){pmAppendItem(vsmPm.appendFrom,vsmPm.appendTo,id.x);}
/** The counts that follow it, one thread. */
@compute @workgroup_size(1)
fn vsmAppendCounts(){pmAppendCounts(vsmPm.appendFrom,vsmPm.appendTo);}
`,
)
