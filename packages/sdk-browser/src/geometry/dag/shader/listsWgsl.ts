import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { OPEN_SLICE_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { LEVEL_QUEUES } from './levelWgsl.ts'

/**
 * THE CUT'S LISTS IN `flags` AND THEIR COUNTERS IN `work`: the descent array (`levelWgsl.ts`), the
 * candidate clusters, the live list (`liveWgsl.ts`), the drawn log (`swapWgsl.ts`) and the post
 * pass's held items (`postPassWgsl.ts`), each section where the host lays it out
 * (`../flagSections.ts`), and the one append every list goes through (`listAppend`).
 *
 * THE DESCENT ARRAY holds every level of a pass one behind the other: a level's entries start where
 * the level before it ends (`queueStart`), so the pass's nodes take the array once, never a room
 * each level. Three slots in rotation count them (`queueCounter`): the level a slot names reads its
 * own, and appends the next level's behind them.
 *
 * THE LISTS' CAPS (`../lists/cutListCaps.ts`): the nodes one pass opens, the candidate clusters
 * and the clusters drawn each have a budget, counted past it (`withinBudget`): what passes it is
 * dropped — a node with its subtree, a cluster neither tested nor drawn —, what fits is drawn, and
 * the readback brings the counts back (`commitWgsl.ts`), which the host says when they pass
 * (`../lists/listFeedback.ts`). The candidates and the clusters the previous pyramid hid share one
 * list and one budget: the descent's from its first entry, those held from its last.
 */
/** Words of a candidate entry — the page, its placement —, the descent's or one the previous
 *  pyramid hid, `candCap` of them. */
export const CAND_WORDS = 2
/** Words of the visible lists, for one entry of each: the live list, two (`liveWgsl.ts`); the
 *  drawn log, one (`swapWgsl.ts`), copied from the live list (`dagCommitMask`); `visCap` of each. */
export const VISIBLE_WORDS = 3
/** Words of an item the previous pyramid hid (`postNode`): the first item, its placement, and the
 *  mask of the items held from it — a node's children, as their parent holds them. */
export const POST_WORDS = 3

export const DAG_LISTS_WGSL = wgslBlock(
  'DAG_LISTS_WGSL',
  [OPEN_SLICE_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX],
  `/** Entries the descent array holds from word 0 — two words each, the entry then the placement
 *  that reads it —, and as many items the previous pyramid hid (\`postNodeBase\`). */
fn queueEntries()->u32{return views[0u].queueCap/2u;}
/** The entry the level slot \`q\` counts starts at in the descent array. */
fn queueStart(q:u32)->u32{return atomicLoad(&work[queueStartWord(q)]);}
/** Where the level after the one slot \`q\` counts starts: behind its entries, every one appended
 *  before that level runs. */
fn queueAfter(q:u32)->u32{return queueStart(q)+atomicLoad(&work[queueCounter(q)]);}
/** Of the entries slot \`q\` counts, those the array held: past its room, none was written. */
fn queueHeld(q:u32)->u32{
 let start=queueStart(q);
 return select(0u,min(atomicLoad(&work[queueCounter(q)]),queueEntries()-start),start<queueEntries());
}
/** The first word of entry \`s\` of the level slot \`q\` counts. */
fn queueEntry(q:u32,s:u32)->u32{return 2u*(queueStart(q)+s);}
/** The candidates behind the descent array, two words each, the page then its placement:
 *  \`candCap\` of them, the descent's from the first, both passes', and from the last those the
 *  previous pyramid hid (\`postClusterAt\`), the one budget all of them share keeping them apart
 *  (\`candAppend\`, \`postCluster\`). */
fn candBase()->u32{return views[0u].queueCap;}
/** The drawn log of the last cut committed, a word a page, \`visCap\` of them, behind the live list
 *  (\`swapWgsl.ts\`, \`dagCommitMask\`). */
fn journalBase()->u32{return views[0u].queueCap+2u*views[0u].candCap+2u*views[0u].visCap;}
/** The items the previous pyramid hid, behind the drawn log, \`${POST_WORDS}\` words each
 *  (\`postNode\`), as many as the descent array's entries (\`postPassWgsl.ts\`). */
fn postNodeBase()->u32{return journalBase()+views[0u].visCap;}
/** The \`s\`-th cluster the previous pyramid hid: from the candidates' end, down. */
fn postClusterAt(s:u32)->u32{return candBase()+${CAND_WORDS}u*(views[0u].candCap-1u-s);}
fn queueCounter(q:u32)->u32{return liveCounter()+3u+q;}
/** Queue \`q\`'s group count, x then y, which a level past the first dispatches on (\`armWgsl.ts\`). */
fn queueGroups(q:u32)->u32{return listGroups(3u+q);}
fn candCounter()->u32{return liveCounter()+6u;}
fn candGroups()->u32{return candCounter()+1u;}
fn drawnCounter()->u32{return liveCounter()+9u;}
fn drawnGroups()->u32{return drawnCounter()+1u;}
/** The entry the level slot \`q\` counts starts at (\`queueStart\`). */
fn queueStartWord(q:u32)->u32{return liveCounter()+12u+q;}
/** The post lists' counts and group counts. */
fn postNodeCounter()->u32{return liveCounter()+15u;}
fn postNodeGroups()->u32{return postNodeCounter()+1u;}
fn postClusterCounter()->u32{return liveCounter()+18u;}
fn postClusterGroups()->u32{return postClusterCounter()+1u;}
/** Where the running pass's candidates and live entries begin — zero in the main pass, behind the
 *  main pass's in the post pass (\`dagPostPrepare\`): the live one its count as asked, past the cap
 *  too —, and the word the pass is told in (\`cutPass\`). */
fn candFirstWord()->u32{return liveCounter()+21u;}
fn liveFirstWord()->u32{return liveCounter()+22u;}
fn passWord()->u32{return liveCounter()+23u;}
/** The hierarchy nodes pass \`p\` opened (\`CUT_MAIN\`, \`CUT_POST\`) — the post pass's those its held
 *  nodes ask too —, and the candidate clusters the cut listed, both passes' and those the previous
 *  pyramid hid: what the budgets count (\`withinBudget\`), past their caps, and the nodes' peaks the
 *  readback brings back (\`dagCommitMask\`). */
fn nodeTotalWord(p:u32)->u32{return liveCounter()+24u+p;}
fn clusterTotalWord()->u32{return liveCounter()+26u;}
/** Of those, the candidates the main pass listed itself, asked past the cap too: the rest of the
 *  total is the post pass's — what the main pass held for it and what it listed. */
fn mainClusterWord()->u32{return liveCounter()+27u;}
fn candFirst()->u32{return atomicLoad(&work[candFirstWord()]);}
fn liveFirst()->u32{return atomicLoad(&work[liveFirstWord()]);}
/** THE ONE LIST APPEND of the cut: \`count\` entries reserved at \`counter\`, \`stride\` words each at
 *  \`base\` — the entry \`first + k\`, then the placement \`w\` reading it, as many as the stride
 *  holds. Past the list's \`cap\` entries nothing is written: the cut draws what fits. The
 *  dispatch argument at \`groups\` follows the opening of each slice of \`WORKGROUP_THREADS\` from
 *  \`origin\` — the rank the running pass's part of the list starts at —, so it equals
 *  \`ceil((total - origin)/WORKGROUP_THREADS)\` without a one-thread kernel pulling it afterwards
 *  (\`openSlice\`); \`NO_INDEX\` for a list no kernel dispatches on. */
fn listAppend(counter:u32,groups:u32,base:u32,stride:u32,cap:u32,origin:u32,first:u32,count:u32,w:u32){
 let at=atomicAdd(&work[counter],count);
 for(var k=0u;k<count;k++){
  let s=at+k;
  if(s>=cap){return;}
  setFlag(base+stride*s,first+k);
  if(stride>1u){setFlag(base+stride*s+1u,w);}
  if(groups!=NO_INDEX&&(s-origin)%WORKGROUP_THREADS==0u){openSlice(groups,(s-origin)/WORKGROUP_THREADS);}
 }
}
/** Of \`count\` entries a list a budget bounds asks, those the budget \`cap\` still holds — every one
 *  asked counted at \`total\`, past the cap too: the peak the readback brings back. */
fn withinBudget(total:u32,cap:u32,count:u32)->u32{
 let before=atomicAdd(&work[total],count);
 return min(count,select(0u,cap-before,before<cap));
}
/** \`count\` entries from \`first\` for the level slot \`dst\` counts, read by placement \`w\` — a
 *  primitive's nodes are its placements' alike —, behind the entries of the level that appends
 *  them, its group count opened as it fills: a level past the first is dispatched on what the
 *  level before it deposited (\`../encode.ts\`). A placement's own node — under the cells a
 *  placement tree lays past them — is one its pass opens, held to the pass's budget
 *  (\`nodeBudget\`, \`cutMaxNodes\`): past it, the node and its subtree are not walked. */
fn queueAppend(dst:u32,first:u32,count:u32,w:u32){
 var kept=count;
 if(first<select(views[0u].nodeCount,views[0u].cellBase,hasTree())){kept=withinBudget(nodeTotalWord(cutPass()),views[0u].nodeBudget,count);}
 let start=queueAfter((dst+${LEVEL_QUEUES - 1}u)%${LEVEL_QUEUES}u);
 let room=select(0u,queueEntries()-start,start<queueEntries());
 listAppend(queueCounter(dst),queueGroups(dst),2u*start,2u,room,0u,first,kept,w);
}
/** Entry \`s\` of queue 0 as a pass starts, at the descent array's head: its entry word, then its
 *  placement. */
fn putEntry(s:u32,entry:u32,w:u32){setFlag(2u*s,entry);setFlag(2u*s+1u,w);}
/** \`count\` pages from \`first\` of placement \`w\` on the candidates, behind the running pass's first
 *  (\`candFirst\`), within the budget they share with the clusters held for the post pass
 *  (\`cutMaxCandidateClusters\`): past it, they are neither tested nor drawn. */
fn candAppend(first:u32,count:u32,w:u32){
 let kept=withinBudget(clusterTotalWord(),views[0u].candCap,count);
 if(cutPass()==CUT_MAIN){atomicAdd(&work[mainClusterWord()],count);}
 listAppend(candCounter(),candGroups(),candBase(),2u,views[0u].candCap,candFirst(),first,kept,w);
}
/** Items \`first + b\` of placement \`w\`, one for each bit \`b\` of \`mask\`, which the previous image's
 *  pyramid alone hides: held for the post pass as one entry, which tests them again
 *  (\`postPassWgsl.ts\`) — the children of a node, held by their parent (\`openNode\`), a placement's
 *  root or a cell of the tree, each alone. */
fn postNode(first:u32,w:u32,mask:u32){
 let s=atomicAdd(&work[postNodeCounter()],1u);
 atomicAdd(&out.occluded,countOneBits(mask));
 if(s>=queueEntries()){return;}
 let at=postNodeBase()+${POST_WORDS}u*s;
 setFlag(at,first);setFlag(at+1u,w);setFlag(at+2u,mask);
 if(s%WORKGROUP_THREADS==0u){openSlice(postNodeGroups(),s/WORKGROUP_THREADS);}
}
/** Page \`page\` of placement \`w\`, drawn by the cut rule, which the previous pyramid alone hides:
 *  held for the post pass from the candidates' end (\`postClusterAt\`), within their budget. */
fn postCluster(page:u32,w:u32){
 if(withinBudget(clusterTotalWord(),views[0u].candCap,1u)==0u){return;}
 let s=atomicAdd(&work[postClusterCounter()],1u);let at=postClusterAt(s);
 setFlag(at,page);setFlag(at+1u,w);
 if(s%WORKGROUP_THREADS==0u){openSlice(postClusterGroups(),s/WORKGROUP_THREADS);}
 atomicAdd(&out.occluded,1u);
}
/** Frame counters, reset by a single thread. Queue 0 already counts its slots: one thread per
 *  slot has just deposited its own, at its own rank from the array's head, with no counter to
 *  contest (\`rootSlots\`). */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);resetGrid(liveGroups());
 atomicStore(&work[queueCounter(0u)],rootSlots());
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueCounter(2u)],0u);
 for(var q=0u;q<${LEVEL_QUEUES}u;q++){resetGrid(queueGroups(q));atomicStore(&work[queueStartWord(q)],0u);}
 atomicStore(&work[candCounter()],0u);resetGrid(candGroups());
 atomicStore(&work[postNodeCounter()],0u);resetGrid(postNodeGroups());
 atomicStore(&work[postClusterCounter()],0u);resetGrid(postClusterGroups());
 atomicStore(&work[candFirstWord()],0u);atomicStore(&work[liveFirstWord()],0u);
 atomicStore(&work[passWord()],CUT_MAIN);
 atomicStore(&work[nodeTotalWord(CUT_MAIN)],0u);atomicStore(&work[nodeTotalWord(CUT_POST)],0u);
 atomicStore(&work[clusterTotalWord()],0u);atomicStore(&work[mainClusterWord()],0u);
}
/** A list's dispatch argument, x and y, back to no group. */
fn resetGrid(groups:u32){atomicStore(&work[groups],0u);atomicStore(&work[groups+1u],0u);}
`,
)
