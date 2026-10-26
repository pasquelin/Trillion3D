import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { HELD_BY_WORD, MARK_WORD, PAGE_BASE_WORD, ROOT_WORD } from '../frameTable.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { CAMERA_DESCENT, type DescentShape } from './descentShape.ts'

/**
 * Level-by-level descent of the cut hierarchy, and the subtree pruning it allows.
 *
 * One thread per node tested in isolation, then one thread per cluster rereading its cluster
 * record to read, most of the time, only its leaf node's flag, would still visit the clusters of
 * a rejected node: two million threads and as many 112-byte reads per frame, to keep a fifth of
 * them.
 *
 * The hierarchy already holds everything needed not to read them: `firstChild`,
 * `childCount`, an aggregated box and an aggregated `maxParentError`, both monotonic
 * — a node's box contains its children's, and its error ceiling upper-bounds theirs.
 * A node outside the trunk, or whose ceiling falls under the threshold, can therefore
 * carry no kept child and no kept cluster: that is the invariant CPU descent
 * (`../../cut/visit.fixture.ts`) already exploits.
 *
 * Descent is therefore by levels. Queue 0 holds what the descent tests first — one placement's root
 * per slot, or the placement tree's top cells (`placementTreeWgsl.ts`), each flagged to be tested
 * (`ENTRY_TEST`) — and pass 0 tests them. Every later queue holds only what the level before it
 * KEPT: a pass reads an accepted node and tests its children in its own thread — each in the
 * frustum, its subtree needed at the threshold, not too coarse, then under the pyramid
 * (`occlusionWgsl.ts`) —, and only the children it keeps enter the next queue. A kept leaf asks for
 * its pages in one request, loaded or not, and, loaded, deposits them in the candidate list, which
 * `dagWanted` then dispatches over (`depositLeaf`); the children of a node the previous image's
 * pyramid alone hides are held for the post pass by their parent, one entry and the mask of them
 * (`openNode`, `postNode`), which the post pass tests again (`postPassWgsl.ts`) — but a leaf none
 * of whose pages is resident, which is dropped (`heldBack`). The pass count is the hierarchy depth,
 * known at packing and small, less the levels no resident page needs reached (`encode.ts`): pass
 * `L` tests the items of depth `L`.
 *
 * Every level lies in the one descent array, behind the level before it (`listsWgsl.ts`,
 * `queueStart`). Level 0 is launched FLAT on queue 0's slots, at the array's head; every later level
 * on what the level before it deposited: its groups open as it fills (`openSlice`) and are armed in
 * the pass (`armWgsl.ts`), one more dispatch of the head pass, never a copy outside it. Entries past
 * the level's count leave on the guard.
 *
 * THREE counting slots in rotation, not two: the counter of the level a level will fill must
 * be zero before it writes there, and with two slots that reset could only come from
 * the CPU, one more copy per level. With three slots, level `L` zeroes slot
 * `(L+2) % 3`: it does not read it — it reads `L % 3` — and does not write it — it
 * writes `(L+1) % 3` —, so none of its children can see it change, and the next pass
 * writes on a clean slot. Level `L` also says where the level it fills starts — behind its own
 * entries, all appended before it runs —, which each of its threads appending there reckons alike.
 * Flat dispatch always opens at least one workgroup, so both always happen.
 */
/** Descent slots, in rotation: level `L` reads `L % LEVEL_QUEUES`, writes `(L+1) % …`
 *  and zeroes `(L+2) % …`, which it neither reads nor writes. Three is the smallest
 *  count that makes those three indices distinct. */
export const LEVEL_QUEUES = 3

/** Placement `w`'s root mark (`PackedDag.mark`), the word behind its record shift, in the frame
 *  words its host binds as `frames`: the descent's, and the world's switch a pass beside it reads
 *  (`worldGateWgsl.ts`). */
export const DAG_MARK_OF_WGSL = wgslFn(
  'markOf',
  [],
  `fn markOf(w:u32)->u32{return framesWord(w,${MARK_WORD}u);}`,
)
/** Placement `w`'s first page, its shared nodes counting their pages from it, in the frame words
 *  its host binds as `frames` (`DAG_MARK_OF_WGSL`). */
export const DAG_PAGE_BASE_OF_WGSL = wgslFn(
  'pageBaseOf',
  [],
  `fn pageBaseOf(w:u32)->u32{return framesWord(w,${PAGE_BASE_WORD}u);}`,
)

/** The level step: an entry of the level slot read, tested or opened. */
const levelStepWgsl = (shape: DescentShape) =>
  `/** Index of the primitive's root node, deposited once and for all. */
fn rootOf(w:u32)->u32{return framesWord(w,${ROOT_WORD}u);}
/** The open counts placement \`w\` holds of its own (\`../heldOpen.ts\`): none, it reads its nodes'. */
fn heldByOf(w:u32)->u32{return framesWord(w,${HELD_BY_WORD}u);}
/** Entry \`s\` of the level slot \`src\` counts: an item flagged to be tested is tested, an accepted
 *  node has its children tested, a member a kept group deposited is tested as its placement's
 *  instance; what is kept enters the NEXT level, behind this one's entries — a leaf's pages the
 *  candidate list —, what the previous image's pyramid alone hides the post list. */
fn levelStep(src:u32,s:u32){
 let dst=(src+1u)%${LEVEL_QUEUES}u;
 // The slot the level after next will fill resets to zero here: this level neither reads nor
 // writes it. The level this one fills starts behind its entries. Its first thread always runs: a
 // level past the first dispatches one workgroup at least.
 if(s==0u){
  let q=(src+2u)%${LEVEL_QUEUES}u;atomicStore(&work[queueCounter(q)],0u);resetGrid(queueGroups(q));
  atomicStore(&work[queueStartWord(dst)],queueAfter(src));
 }
 if(s>=queueHeld(src)){return;}
 let at=queueEntry(src,s);
 let entry=flagAt(at);
 if(entry==NO_INDEX){return;}
 let w=flagAt(at+1u);${shape.views ? '\n descentView=flagAt(at+2u);' : ''}
 let index=entry&ENTRY_INDEX;let tests=(entry&ENTRY_TEST)!=0u;
 // Past the nodes, a member a kept group of the tree deposited; past the placements' own nodes, a
 // cell of the tree (\`placementTreeWgsl.ts\`).
 if(index>=cutView.nodeCount){testMember(dst,index-cutView.nodeCount);return;}
 if(hasTree()&&index>=cutView.cellBase){
  let t=index-cutView.cellBase;
  if(tests){testCell(dst,t);}else{openCell(dst,t);}
  return;
 }
 if(tests){testRoot(dst,w);}else{openNode(dst,index,w);}
}
`

/** The tests of a placement's root and of a node, and the children held for the post pass. */
const levelTestWgsl = (shape: DescentShape) =>
  `/** Placement \`w\`'s root, tested as its instance: the view's filter (\`filteredOut\`), its draw
 *  distance (\`outsideDrawDistance\`), the group above its root (\`outsideRootParent\`), the view's
 *  clip plane (\`outsideClipPlane\`), its box in the frustum, then under the pyramid. Kept, it is accepted (\`acceptNode\`): no error of its
 *  own is compared, the root's children are. The previous pyramid alone hiding it, the instance is
 *  held whole for the post pass. */
fn testRoot(dst:u32,w:u32){
 if(filteredOut(w)){return;}
 let root=rootOf(w);let node=nodeAt(root);let mark=markOf(w);deformReach=markReach(mark);
 if(outsideDrawDistance(w,mark,node)){return;}
 if(outsideRootParent(w,mark)){return;}
 if(outsideClipPlane(w,node.minimum,node.maximum)){return;}
 if(outsideFrustum(w,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return;}
 let sight=sightOf(node,w);
 if(sight==BOX_SEEN){acceptNode(dst,root,node,w);}
 if(sight==BOX_OCCLUDED){postNode(root,w,1u);}
}
/** The children of node \`index\` of placement \`w\`, accepted at the level before, each tested; those
 *  the previous pyramid alone hides held for the post pass by their parent, one entry and the mask of
 *  them, within the post pass's node budget (\`nodeBudget\`) — a run of thirty-two children an entry,
 *  a mask word's bits. */
fn openNode(dst:u32,index:u32,w:u32){
 let node=nodeAt(index);deformReach=reachOf(w);
 var held=0u;
 for(var k=0u;k<node.childCount;k++){
  if(testNode(dst,node.firstChild+k,w)){held|=1u<<(k%32u);}
  if(held!=0u&&(k%32u==31u||k+1u==node.childCount)){
   if(withinBudget(nodeTotalWord(CUT_POST),cutView.nodeBudget,1u)!=0u){postNode(node.firstChild+k-k%32u,w,held);}
   held=0u;
  }
 }
}
/** Node \`c\` of placement \`w\`: not a world actor's its cell does not draw (\`worldNodeHides\`), not
 *  behind the view's clip plane (\`outsideClipPlane\`), in the frustum, its subtree needed — the
 *  error it replaces seen at the threshold (\`subtreeNeeded\`) —, a leaf not too coarse — its floor within the threshold, unless it is open
 *  (\`floorPrunes\`) —, then under the pyramid: seen, it is accepted. Whether the previous pyramid
 *  alone hides it and it waits for the post pass (\`heldBack\`). The trunk-reject count moves for the
 *  frustum and the ceiling, never for the floor nor an actor not drawn. */
fn testNode(dst:u32,c:u32,w:u32)->bool{
 if(worldNodeHides(c,w)){return false;}
 let node=nodeAt(c);
 if(outsideClipPlane(w,node.minimum,node.maximum)){return false;}
 if(outsideFrustum(w,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return false;}
 let e=viewWorld(w);
 if(!${shape.subtreeNeeded}){atomicAdd(&out.frustumRejected,1u);return false;}
 if(floorPrunes(openOf(w,c,node.open),node,e)){return false;}
 let sight=sightOf(node,w);
 if(sight==BOX_SEEN){acceptNode(dst,c,node,w);}
 return sight==BOX_OCCLUDED&&heldBack(node,w);
}
`

/** What the pyramid says of a node, and what a leaf kept requests and lists. */
const levelLeafWgsl = (shape: DescentShape) =>
  `${
    shape.cameraSubtree
      ? `/** Whether a node's subtree is needed at the threshold: the error its clusters replace is seen
 *  (\`errorShows\`), or none bounds it. A deformation moves no LOD ball: the rest pose's are read. */
fn subtreeNeeded(node:CullNode,edge:f32)->bool{
 return node.maxParentError<0.0||errorShows(edge,node.maxParentError);
}
`
      : ''
  }/** The pyramid's verdict on \`node\` of placement \`w\` once it passed its frustum (\`boxSight\`): a
 *  placement no camera culls is always seen. */
fn sightOf(node:CullNode,w:u32)->u32{
 if(unculledOf(w)){return BOX_SEEN;}
 return boxSight(node.minimum,node.maximum,w);
}
/** Whether \`node\` of placement \`w\`, below its root and hidden by the previous pyramid alone, waits
 *  for the post pass: an inner node, or a leaf with a resident page (\`isResident\`), what the post
 *  pass can draw of it. A leaf none of whose pages is resident is dropped, neither tested again nor
 *  asked for this image. */
fn heldBack(node:CullNode,w:u32)->bool{
 return node.childCount>0u||leafLoaded(pageBaseOf(w)+node.firstPage,node.pageCount);
}
/** Whether a page of the \`count\` from \`first\`, a leaf's, is resident: what the cut can draw. */
fn leafLoaded(first:u32,count:u32)->bool{
 for(var k=0u;k<count;k++){if(isResident(first+k)){return true;}}
 return false;
}
/** Node \`index\` of placement \`w\` kept: its children tested at the next level, or, a leaf, its pages
 *  deposited. */
fn acceptNode(dst:u32,index:u32,node:CullNode,w:u32){
 if(node.childCount>0u){queueAppend(dst,index,1u,w);return;}
 depositLeaf(node,w);
}
/** A leaf kept and seen: ONE request for its pages — the first of them, counted from the
 *  placement's first, how many, and the leaf's priority (\`leafPriority\`) —, whatever they hold
 *  resident; its pages are candidates only when it is loaded (\`leafLoaded\`), else the cut draws
 *  its parent, whose finer group is not resident (\`childResident\`). */
fn depositLeaf(node:CullNode,w:u32){
 let first=pageBaseOf(w)+node.firstPage;
 requestPage(first,node.pageCount,${shape.priority});
 if(leafLoaded(first,node.pageCount)){candAppend(first,node.pageCount,w);}
}
`

/** The kernels of the levels, a thread an entry. */
const levelEntriesWgsl = () =>
  `/** Queue \`q\`'s level, a thread an entry. Pass 0 is \`dagLevel0\` on queue 0: without a tree one root
 *  per slot, with one its few entries (\`rootSlots\`); queue 0 reused deeper (level 3, 6…) alike. */
${Array.from(
  { length: LEVEL_QUEUES },
  (_, q) => `@compute @workgroup_size(WORKGROUP_THREADS)
fn dagLevel${q}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){levelStep(${q}u,flatIndex(id,n,WORKGROUP_THREADS));}`,
).join('\n')}
`

/** The level descent of `shape` (`descentShape.ts`): the camera's cut's (`DAG_LEVEL_WGSL`), or a
 *  views descent's, which reads each entry's view with it and tests a node's subtree by its views'
 *  rule. */
export const dagLevelWgsl = (shape: DescentShape) =>
  wgslBlock(
    shape.views ? 'DAG_LEVEL_VIEWS_WGSL' : 'DAG_LEVEL_WGSL',
    [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX, DAG_MARK_OF_WGSL, DAG_PAGE_BASE_OF_WGSL],
    levelStepWgsl(shape) + levelTestWgsl(shape) + levelLeafWgsl(shape) + levelEntriesWgsl(),
  )

export const DAG_LEVEL_WGSL = dagLevelWgsl(CAMERA_DESCENT)
