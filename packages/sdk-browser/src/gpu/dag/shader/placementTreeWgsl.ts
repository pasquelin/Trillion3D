import { REACH_UNBOUNDED, TREE_GROUP } from '../placementTree.ts'
import { NODE_CHILD_COUNT, NODE_FIRST_CHILD, NODE_KIND, NODE_MAX, NODE_MIN } from '../nodeLayout.ts'
import { CARD_ROOT, SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { boxBehindPlane } from '../../../../../math/src/wgsl/geometry.ts'
import { outsidePlanesFn } from './outsidePlanesWgsl.ts'
import { LEVEL_QUEUES } from './levelWgsl.ts'

/**
 * The placement tree in the descent (`../placementTree.ts`): its levels top first, the last its
 * instance groups, then the placements a kept group holds, each level culled before the next one
 * is read. Its nodes, its order and its list of members drawn whatever the view are read where
 * they lie, in its record table (`tree`, `../treeTable.ts`); a queue entry names node `t` of it as
 * `cellBase + t`, past the placements' own nodes.
 *
 * A tree node is a world box tested against the frustum's render-frame planes, the eye taken off it
 * (`cameraWorld`), under the camera, then — rejected there — under the view ahead, as any node
 * (`aheadWgsl.ts`). A kept cell deposits its children; a kept group deposits its members as
 * entries past the nodes (`nodeCount + k`, `k` a rank of the tree's order). The level that reads a
 * placement's entry tests its root node, making its planes and matrices as it reads them
 * (`primitiveWgsl.ts`), so a placement no kept group holds costs nothing: no planes, no matrix, no
 * root test.
 *
 * With a tree, queue 0 holds its top nodes, then the world DAG's root — the one placement the tree
 * leaves out, wherever the packing put it (`worldRoot`) —, then the members drawn whatever the view
 * (`always`, `../placementTree.ts`: never culled, or deformed past every finite reach), which no
 * group opens; `dagPrepare` writes those alone. Without one, it holds one root per placement.
 */
export const DAG_TREE_PREPARE_WGSL = wgslBlock(
  'DAG_TREE_PREPARE_WGSL',
  [NO_INDEX],
  `/** Whether the cut descends a placement tree (\`treeTop\`, its top level's nodes). */
fn hasTree()->bool{return views[0u].treeTop>0u;}
/** Queue 0's entries a view opens: one root per placement without a tree; with one, its top
 *  nodes, the world DAG's root when it is packed, then the members drawn whatever the view. */
fn rootSlots()->u32{
 let world=select(0u,1u,views[0u].worldRoot!=NO_INDEX);
 return select(views[0u].worldCount,views[0u].treeTop+world+views[0u].alwaysCount,hasTree());
}
/** Whether placement \`w\` is drawn whatever the view, as \`drawnAlways\` says of its mark: never
 *  culled, or deformed past every finite reach (\`reachOf\` infinite). */
fn drawnAlways(w:u32)->bool{let mark=markOf(w);return (mark&${SPRITE_UNCULLED}u)!=0u||(mark>>16u)>=${REACH_UNBOUNDED}u;}
/** The one gate of a placement's root, whoever opens it — \`dagPrepare\` an ungrouped one, its kept
 *  group a member (\`placementStep\`): parked, drawn by its impostor card, or drawn by the world DAG
 *  in its place (\`worldCovers\`), it opens nothing. */
fn opensRoot(w:u32)->bool{return rootOf(w)!=NO_INDEX&&(markOf(w)&${CARD_ROOT}u)==0u&&!worldCovers(w);}
/** Placement \`w\`'s root, at entry \`at\` of queue 0 under the view \`vi\`, or none. */
fn openRoot(at:u32,w:u32){
 putEntry(queueBase(0u),at,select(NO_INDEX,packEntry(vi,rootOf(w)),opensRoot(w)),w);
}
/** \`dagPrepare\`'s thread \`i\` of the bound range, with a tree: the head range writes its top
 *  nodes, the world DAG's range that root behind them, and each member drawn whatever the view is
 *  written behind it by the range that holds it — thread \`top + 1 + j\` of every range, member
 *  \`j\`. */
fn prepareTreeRoots(i:u32){
 let top=select(0u,views[0u].treeTop,rangeFirst()==0u);
 if(i<top){putEntry(queueBase(0u),i,packEntry(0u,treeEntry(i)),0u);return;}
 let w=views[0u].worldRoot;
 if(i==top){if(w!=NO_INDEX&&inRange(w)){vi=0u;openRoot(views[0u].treeTop,w);}return;}
 let j=i-top-1u;
 if(j>=views[0u].alwaysCount){return;}
 let m=treeAlwaysAt(j);
 if(inRange(m)){vi=0u;openRoot(views[0u].treeTop+select(0u,1u,w!=NO_INDEX)+j,m);}
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
/** Member \`k\` of the tree's order (\`treeMember\`), deposited by its kept group under the view
 *  \`vi\`: its root tested as pass 0 tests an ungrouped one, unless its gate closes it
 *  (\`opensRoot\`) or queue 0 opened it already (\`drawnAlways\`). */
fn placementStep(src:u32,k:u32){
 let w=treeMember(k);
 if(w==NO_INDEX||!inRange(w)||!opensRoot(w)||drawnAlways(w)){return;}
 nodeStep(src,rootOf(w),w);
}
/** Node \`t\`'s box corner from word \`k\`. */
fn treeCorner(t:u32,k:u32)->vec3f{
 return vec3f(bitcast<f32>(treeWord(t,k)),bitcast<f32>(treeWord(t,k+1u)),bitcast<f32>(treeWord(t,k+2u)));
}
/** Cell or group \`t\` of the tree: its world box under the camera, then under the view ahead. Its
 *  world is the first (\`NODE_WORLD\`), so one range's dispatch reads it. */
fn treeStep(src:u32,t:u32){
 if(!inRange(0u)){return;}
 deformReach=0.0;
 let lo=treeCorner(t,${NODE_MIN}u)-views[0u].cameraWorld;let hi=treeCorner(t,${NODE_MAX}u)-views[0u].cameraWorld;
 if(aheadOn()&&vi==AHEAD_VIEW){if(!outsideView(AHEAD_VIEW,lo,hi)){descendTree(src,t);}return;}
 if(outsideView(0u,lo,hi)){
  atomicAdd(&out.frustumRejected,1u);
  if(aheadOn()&&!outsideView(AHEAD_VIEW,lo,hi)){vi=AHEAD_VIEW;descendTree(src,t);}
  return;
 }
 descendTree(src,t);
}
/** View \`v\`'s frustum test of a render-frame box, as \`outsideFrustum\` tests a primitive's: an
 *  infinite far plane (a NaN plane, \`farless\`) rejects nothing. */
${outsidePlanesFn('outsideView', '', (i) => `views[v].planes[${i}]`)}
/** A kept cell opens its children, nodes of the tree, a kept group its members, in the next
 *  queue. */
fn descendTree(src:u32,t:u32){
 let first=treeWord(t,${NODE_FIRST_CHILD}u);
 let group=treeWord(t,${NODE_KIND}u)==TREE_GROUP;
 queueAppend((src+1u)%${LEVEL_QUEUES}u,select(treeEntry(first),views[0u].nodeCount+first,group),treeWord(t,${NODE_CHILD_COUNT}u),0u);
}
`,
)
