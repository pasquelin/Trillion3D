import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { OPEN_SLICE_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { LEVEL_QUEUES } from './levelWgsl.ts'
import { COUNTER } from './floorWgsl.ts'
import { CAMERA_DESCENT, entryWords, postWords, type DescentShape } from './descentShape.ts'
import { CAND_WORDS, POST_WORDS, flagSectionStartExpression } from '../flagSections.ts'

/** A views descent writes each entry's view beside its placement: the running entry's. */
const viewFlag = (shape: DescentShape, at: string) =>
  shape.views ? `setFlag(${at},descentView);` : ''

/** The counters, the descent array and the candidates of a descent of `shape`. */
const listsLayoutWgsl = (shape: DescentShape) => {
  const E = entryWords(shape)
  return `${shape.views ? '/** The view the running entry is tested by, read with it (`levelStep`) and written with every\n *  entry it appends. */\nvar<private> descentView:u32;\n' : ''}/** Entries the descent array holds from word 0 — two words each, the entry then the placement
 *  that reads it —, and as many items the previous pyramid hid (\`postNodeBase\`). */
fn queueEntries()->u32{return cutView.queueCap/${E}u;}
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
fn queueEntry(q:u32,s:u32)->u32{return ${E}u*(queueStart(q)+s);}
/** The candidates behind the descent array, two words each, the page then its placement:
 *  \`candCap\` of them, the descent's from the first, both passes', and from the last those the
 *  previous pyramid hid (\`postClusterAt\`), the one budget all of them share keeping them apart
 *  (\`candAppend\`, \`postCluster\`). */
fn candBase()->u32{return ${flagSectionStartExpression(1)};}
/** The items the previous pyramid hid, behind the candidates, \`${POST_WORDS}\` words each
 *  (\`postNode\`), as many as the descent array's entries (\`postPassWgsl.ts\`). */
fn postNodeBase()->u32{return ${flagSectionStartExpression(2)};}
/** The \`s\`-th cluster the previous pyramid hid: from the candidates' end, down. */
fn postClusterAt(s:u32)->u32{return candBase()+${CAND_WORDS}u*(cutView.candCap-1u-s);}
/** The frame counters, from \`counterBase()\` (\`COUNTER\`, \`floorWgsl.ts\`). */
fn visibleGroups()->u32{return counterBase()+${COUNTER.visibleGroups}u;}
fn queueCounter(q:u32)->u32{return counterBase()+${COUNTER.queue}u+q;}
/** Queue \`q\`'s group count, x then y, which a level past the first dispatches on (\`armWgsl.ts\`). */
fn queueGroups(q:u32)->u32{return counterBase()+${COUNTER.queueGroups}u+2u*q;}
fn candCounter()->u32{return counterBase()+${COUNTER.cand}u;}
fn candGroups()->u32{return counterBase()+${COUNTER.candGroups}u;}
/** The entry the level slot \`q\` counts starts at (\`queueStart\`). */
fn queueStartWord(q:u32)->u32{return counterBase()+${COUNTER.queueStart}u+q;}
/** The post lists' counts and group counts. */
fn postNodeCounter()->u32{return counterBase()+${COUNTER.postNode}u;}
fn postNodeGroups()->u32{return counterBase()+${COUNTER.postNodeGroups}u;}
fn postClusterCounter()->u32{return counterBase()+${COUNTER.postCluster}u;}
fn postClusterGroups()->u32{return counterBase()+${COUNTER.postClusterGroups}u;}
/** Where the running pass's candidates begin — zero in the main pass, behind the main pass's in the
 *  post pass (\`dagPostPrepare\`) — and the word the pass is told in (\`cutPass\`). */
fn candFirstWord()->u32{return counterBase()+${COUNTER.candFirst}u;}
fn passWord()->u32{return counterBase()+${COUNTER.pass}u;}
/** The hierarchy nodes pass \`p\` opened (\`CUT_MAIN\`, \`CUT_POST\`) — the post pass's those its held
 *  nodes ask too —, and the candidate clusters the cut listed, both passes' and those the previous
 *  pyramid hid: what the budgets count (\`withinBudget\`), past their caps, and the nodes' peaks the
 *  readback brings back (\`dagFinish\`). */
fn nodeTotalWord(p:u32)->u32{return counterBase()+${COUNTER.nodeTotal}u+p;}
fn clusterTotalWord()->u32{return counterBase()+${COUNTER.clusterTotal}u;}
/** Of those, the candidates the main pass listed itself, asked past the cap too: the rest of the
 *  total is the post pass's — what the main pass held for it and what it listed. */
fn mainClusterWord()->u32{return counterBase()+${COUNTER.mainCluster}u;}
fn candFirst()->u32{return atomicLoad(&work[candFirstWord()]);}
`
}

/** The one append every list goes through, its budget, and the descent array's append. */
const listAppendWgsl = (shape: DescentShape) => {
  const E = entryWords(shape)
  return `/** THE ONE LIST APPEND of the cut: \`count\` entries reserved at \`counter\`, \`stride\` words each at
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
${shape.views ? `  if(stride>2u){${viewFlag(shape, 'base+stride*s+2u')}}\n` : ''}  if(groups!=NO_INDEX&&(s-origin)%WORKGROUP_THREADS==0u){openSlice(groups,(s-origin)/WORKGROUP_THREADS);}
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
 if(first<select(cutView.nodeCount,cutView.cellBase,hasTree())){kept=withinBudget(nodeTotalWord(cutPass()),cutView.nodeBudget,count);}
 let start=queueAfter((dst+${LEVEL_QUEUES - 1}u)%${LEVEL_QUEUES}u);
 let room=select(0u,queueEntries()-start,start<queueEntries());
 listAppend(queueCounter(dst),queueGroups(dst),${E}u*start,${E}u,room,0u,first,kept,w);
}
`
}

/** The head of the descent array and the append of the candidates. */
const listEntriesWgsl = (shape: DescentShape) => {
  const E = entryWords(shape)
  return `/** Entry \`s\` of queue 0 as a pass starts, at the descent array's head: its entry word, then its
 *  placement. */
${
  shape.views
    ? `fn putEntry(s:u32,entry:u32,w:u32){let at=${E}u*(s+descentView*rootSlots());setFlag(at,entry);setFlag(at+1u,w);${viewFlag(shape, 'at+2u')}}`
    : 'fn putEntry(s:u32,entry:u32,w:u32){setFlag(2u*s,entry);setFlag(2u*s+1u,w);}'
}
/** \`count\` pages from \`first\` of placement \`w\` on the candidates, behind the running pass's first
 *  (\`candFirst\`), within the budget they share with the clusters held for the post pass
 *  (\`cutMaxCandidateClusters\`): past it, they are neither tested nor drawn. */
${
  shape.views
    ? `fn candAppend(first:u32,count:u32,w:u32){
 for(var k=0u;k<count;k++){
  let i=first+k;
  // A page another view kept is listed once: its bit of the descent's mask (\`drawMaskWord\`).
  if(!isResident(i)||(atomicOr(&work[drawMaskWord(i)],drawBit(i))&drawBit(i))!=0u){continue;}
  let kept=withinBudget(clusterTotalWord(),cutView.candCap,1u);
  listAppend(candCounter(),candGroups(),candBase(),${CAND_WORDS}u,cutView.candCap,candFirst(),i,kept,w);
 }
}
`
    : `fn candAppend(first:u32,count:u32,w:u32){
 let kept=withinBudget(clusterTotalWord(),cutView.candCap,count);
 if(cutPass()==CUT_MAIN){atomicAdd(&work[mainClusterWord()],count);}
 listAppend(candCounter(),candGroups(),candBase(),2u,cutView.candCap,candFirst(),first,kept,w);
}
`
}`
}

/** The items and clusters the previous pyramid hides, held for the post pass. */
const listPostWgsl = (shape: DescentShape) => {
  const P = postWords(shape)
  return `/** Items \`first + b\` of placement \`w\`, one for each bit \`b\` of \`mask\`, which the previous image's
 *  pyramid alone hides: held for the post pass as one entry, which tests them again
 *  (\`postPassWgsl.ts\`) — the children of a node, held by their parent (\`openNode\`), a placement's
 *  root or a cell of the tree, each alone. */
fn postNode(first:u32,w:u32,mask:u32){
 let s=atomicAdd(&work[postNodeCounter()],1u);
 atomicAdd(&out.occluded,countOneBits(mask));
 if(s>=queueEntries()){return;}
 let at=postNodeBase()+${P}u*s;
 setFlag(at,first);setFlag(at+1u,w);setFlag(at+2u,mask);${viewFlag(shape, 'at+3u')}
 if(s%WORKGROUP_THREADS==0u){openSlice(postNodeGroups(),s/WORKGROUP_THREADS);}
}
/** Page \`page\` of placement \`w\`, drawn by the cut rule, which the previous pyramid alone hides:
 *  held for the post pass from the candidates' end (\`postClusterAt\`), within their budget. */
fn postCluster(page:u32,w:u32){
 if(withinBudget(clusterTotalWord(),cutView.candCap,1u)==0u){return;}
 let s=atomicAdd(&work[postClusterCounter()],1u);let at=postClusterAt(s);
 setFlag(at,page);setFlag(at+1u,w);
 if(s%WORKGROUP_THREADS==0u){openSlice(postClusterGroups(),s/WORKGROUP_THREADS);}
 atomicAdd(&out.occluded,1u);
}
`
}

/** The frame counters, reset by a single thread. */
const listResetWgsl = (shape: DescentShape) =>
  `/** Frame counters, reset by a single thread. Queue 0 already counts its slots: one thread per
 *  slot has just deposited its own, at its own rank from the array's head, with no counter to
 *  contest (\`rootSlots\`). The visible list's counters (\`visibleWgsl.ts\`) start from none, its
 *  split from no post pass. */
fn resetCounters(){
 resetGrid(visibleGroups());
 atomicStore(&work[queueCounter(0u)],${shape.views ? 'rootSlots()*descentViews()' : 'rootSlots()'});
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueCounter(2u)],0u);
 for(var q=0u;q<${LEVEL_QUEUES}u;q++){resetGrid(queueGroups(q));atomicStore(&work[queueStartWord(q)],0u);}
 atomicStore(&work[candCounter()],0u);resetGrid(candGroups());
 atomicStore(&work[postNodeCounter()],0u);resetGrid(postNodeGroups());
 atomicStore(&work[postClusterCounter()],0u);resetGrid(postClusterGroups());
 atomicStore(&work[candFirstWord()],0u);
 atomicStore(&work[passWord()],CUT_MAIN);
 atomicStore(&work[nodeTotalWord(CUT_MAIN)],0u);atomicStore(&work[nodeTotalWord(CUT_POST)],0u);
 atomicStore(&work[clusterTotalWord()],0u);atomicStore(&work[mainClusterWord()],0u);${shape.resets}
}
/** A list's dispatch argument, x and y, back to no group. */
fn resetGrid(groups:u32){atomicStore(&work[groups],0u);atomicStore(&work[groups+1u],0u);}
`

/**
 * THE CUT'S LISTS IN `flags` AND THEIR COUNTERS IN `work`: the descent array (`levelWgsl.ts`), the
 * candidate clusters and the post pass's held items (`postPassWgsl.ts`), each section where the
 * host lays it out (`../flagSections.ts`), and the one append every list goes through
 * (`listAppend`). The clusters the cut draws are not among them: they go to the list of visible
 * clusters (`visibleWgsl.ts`), a buffer of its own.
 *
 * THE DESCENT ARRAY holds every level of a pass one behind the other: a level's entries start where
 * the level before it ends (`queueStart`), so the pass's nodes take the array once, never a room
 * each level. Three slots in rotation count them (`queueCounter`): the level a slot names reads its
 * own, and appends the next level's behind them.
 *
 * THE LISTS' CAPS (`../lists/cutListCaps.ts`): the nodes one pass opens, the candidate clusters
 * and the clusters drawn each have a budget, counted past it (`withinBudget`): what passes it is
 * dropped — a node with its subtree, a cluster neither tested nor drawn —, what fits is drawn, and
 * the readback brings the counts back (`finishWgsl.ts`), which the host says when they pass
 * (`../lists/listFeedback.ts`). The candidates and the clusters the previous pyramid hid share one
 * list and one budget: the descent's from its first entry, those held from its last.
 */
/** The lists of a descent of `shape` (`descentShape.ts`): the camera's cut's
 *  (`DAG_LISTS_WGSL`), or a views descent's, whose entries carry their view. */
export const dagListsWgsl = (shape: DescentShape) =>
  wgslBlock(
    shape.views ? 'DAG_LISTS_VIEWS_WGSL' : 'DAG_LISTS_WGSL',
    [OPEN_SLICE_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX],
    listsLayoutWgsl(shape) +
      listAppendWgsl(shape) +
      listEntriesWgsl(shape) +
      listPostWgsl(shape) +
      listResetWgsl(shape),
  )

export const DAG_LISTS_WGSL = dagListsWgsl(CAMERA_DESCENT)
