import { TREE_GROUP } from '../placement/placementTree.ts'
import { NODE_CHILD_COUNT, NODE_FIRST_CHILD, NODE_KIND } from '../nodeLayout.ts'
import { SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { boxBehindPlane } from '../../../../../math/src/wgsl/geometry.ts'
import { outsidePlanesFn } from './outsidePlanesWgsl.ts'
import { reachUnboundedWgsl } from '../../../deformation/halfFloat.ts'

/**
 * The placement tree in the descent (`../placement/placementTree.ts`): its levels top first, the last its
 * instance groups, then the placements a kept group holds, each level culled before the next one
 * is read. Its nodes, its order and its list of members drawn whatever the view are read where
 * they lie, in its record table (`tree`, `../tree/treeTable.ts`); a queue entry names node `t` of it as
 * `cellBase + t`, past the placements' own nodes.
 *
 * A tree node is a world box tested against the frustum's render-frame planes, the eye taken off it
 * (`cameraWorld`), then under the pyramid (`occlusionWgsl.ts`); one the previous pyramid alone hides
 * waits for the post pass. A kept cell is accepted: the next level tests its children; a kept group
 * deposits its members as entries past the nodes (`nodeCount + k`, `k` a rank of the tree's order),
 * each tested by the level that reads it as its placement's instance — its root node's box —,
 * making its planes and matrices as it reads them (`primitiveWgsl.ts`), so a placement no kept group
 * holds costs nothing: no planes, no matrix, no root test.
 *
 * With a tree, queue 0 holds its top nodes, then the members drawn whatever the view (`always`,
 * `../placement/placementTree.ts`: never culled, or deformed past every finite reach) and the world DAG's
 * placements — those the tree leaves out, wherever the packing put them —, which no group opens;
 * `dagPrepare` writes those alone, each to be tested (`ENTRY_TEST`). Without one, it holds one root
 * per placement.
 */
export const DAG_TREE_PREPARE_WGSL = wgslBlock(
  'DAG_TREE_PREPARE_WGSL',
  [NO_INDEX, reachUnboundedWgsl],
  `/** Whether the cut descends a placement tree (\`treeTop\`, its top level's nodes). */
fn hasTree()->bool{return views[0u].treeTop>0u;}
/** Queue 0's entries a view opens: one root per placement without a tree; with one, its top
 *  nodes, then the members drawn whatever the view and the world DAG's placements. */
fn rootSlots()->u32{
 return select(views[0u].worldCount,views[0u].treeTop+views[0u].alwaysCount,hasTree());
}
/** Whether placement \`w\` is drawn whatever the view, as \`drawnAlways\` says of its mark: never
 *  culled, or deformed past every finite reach (\`reachOf\` infinite). */
fn drawnAlways(w:u32)->bool{let mark=markOf(w);return (mark&${SPRITE_UNCULLED}u)!=0u||reachUnbounded(mark);}
/** The one gate of a placement's root, whoever opens it — \`dagPrepare\` an ungrouped one, its kept
 *  group a member (\`placementStep\`): parked, or its cell drawn by its HLOD or by nothing
 *  (\`worldCovers\`), it opens nothing. */
fn opensRoot(w:u32)->bool{return rootOf(w)!=NO_INDEX&&!worldCovers(w);}
/** Placement \`w\`'s root at entry \`at\` of queue 0, to be tested as its instance, or none. */
fn openRoot(at:u32,w:u32){
 putEntry(at,select(NO_INDEX,rootOf(w)|ENTRY_TEST,opensRoot(w)),w);
}
/** \`dagPrepare\`'s thread \`i\`, with a tree, writes queue 0's entry \`i\` (\`rootSlots\`): the top
 *  nodes, then each member drawn whatever the view or placement of the world DAG, each to be
 *  tested. */
fn prepareTreeRoots(i:u32){
 let top=views[0u].treeTop;
 if(i<top){putEntry(i,treeEntry(i)|ENTRY_TEST,0u);return;}
 let j=i-top;
 if(j>=views[0u].alwaysCount){return;}
 openRoot(i,treeAlwaysAt(j));
}
`,
)

/** The tree's share of the level descent (`levelWgsl.ts`), on its queues in rotation. */
export const DAG_TREE_DESCENT_WGSL = wgslBlock(
  'DAG_TREE_DESCENT_WGSL',
  [boxBehindPlane, NO_INDEX],
  `const TREE_GROUP:u32=${TREE_GROUP}u;
/** The queue entry of node \`t\` of the tree: past the placements' own nodes. */
fn treeEntry(t:u32)->u32{return views[0u].cellBase+t;}
/** Member \`k\` of the tree's order (\`treeMember\`), deposited by its kept group: its root tested as
 *  queue 0 tests an ungrouped one, unless its gate closes it (\`opensRoot\`) or queue 0 opened it
 *  already (\`drawnAlways\`). */
fn testMember(dst:u32,k:u32){
 let w=treeMember(k);
 if(w==NO_INDEX||!opensRoot(w)||drawnAlways(w)){return;}
 testRoot(dst,w);
}
/** Cell or group \`t\` of the tree, the eye taken off its world box. */
fn cellLow(t:u32)->vec3f{return treeLow(t)-views[0u].cameraWorld;}
fn cellHigh(t:u32)->vec3f{return treeHigh(t)-views[0u].cameraWorld;}
/** Cell or group \`t\` tested: a group within the draw distances its placements name
 *  (\`outsideGroupDrawDistance\`), a group not behind the view's clip plane
 *  (\`outsideGroupClipPlane\`), in the frustum, then under the pyramid — a world box, in the render
 *  frame now and before (\`NO_INDEX\`, \`boxSight\`); kept, it is accepted, the next level reads it
 *  (\`openCell\`); the previous pyramid alone hiding it, it waits for the post pass. */
fn testCell(dst:u32,t:u32){
 deformReach=0.0;
 let lo=cellLow(t);let hi=cellHigh(t);
 if(outsideGroupDrawDistance(t,lo,hi)){return;}
 if(outsideGroupClipPlane(t,lo,hi)){return;}
 if(outsideView(lo,hi)){atomicAdd(&out.frustumRejected,1u);return;}
 let sight=boxSight(lo,hi,NO_INDEX);
 if(sight==BOX_OCCLUDED){postNode(treeEntry(t),0u,1u);}
 if(sight==BOX_SEEN){queueAppend(dst,treeEntry(t),1u,0u);}
}
/** The frustum test of a render-frame box, as \`outsideFrustum\` tests a primitive's: an infinite far
 *  plane (a NaN plane, \`farless\`) rejects nothing. */
${outsidePlanesFn('outsideView', '', (i) => `views[0u].planes[${i}]`)}
/** An accepted cell's children, cells of the tree, each tested; an accepted group's members in the
 *  next queue, each tested by the level that reads it (\`testMember\`). */
fn openCell(dst:u32,t:u32){
 let first=treeWord(t,${NODE_FIRST_CHILD}u);let count=treeWord(t,${NODE_CHILD_COUNT}u);
 if(treeWord(t,${NODE_KIND}u)==TREE_GROUP){queueAppend(dst,views[0u].nodeCount+first,count,0u);return;}
 for(var k=0u;k<count;k++){testCell(dst,first+k);}
}
`,
)
