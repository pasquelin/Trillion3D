import { TREE_GROUP } from '../placementTree.ts'
import { CARD_ROOT } from '../../../visibility/shader/spriteWgsl.ts'

/**
 * The placement tree in the descent (`../placementTree.ts`): its levels top first, the last its
 * instance groups, then the placements a kept group holds, each level culled before the next one
 * is read.
 *
 * A tree node is a world box tested against the frustum's render-frame planes, the eye taken off it
 * (`cameraWorld`), under the camera, then — rejected there — under the view ahead, as any node
 * (`aheadWgsl.ts`). A kept cell deposits its children; a kept group deposits its members as
 * entries past the nodes (`nodeCount + k`, `k` a rank of the tree's order). The level that reads a
 * placement's entry prepares it — the planes and matrices `dagPrepare` derives, in the camera's
 * slot (`preparePlacement`) — then tests its root node in the same thread, so a placement no kept
 * group holds costs nothing: no planes, no matrix, no root test.
 *
 * With a tree, queue 0 holds its top nodes, then the world DAG's root — the one placement the tree
 * leaves out, wherever the packing put it (`worldRoot`) —, and `dagPrepare` writes those alone.
 * Without one, it holds one root per placement, as it always did.
 */
export const DAG_TREE_PREPARE_WGSL = `/** Whether the cut descends a placement tree (\`treeTop\`, its top level's nodes). */
fn hasTree()->bool{return views[0u].treeTop>0u;}
/** Queue 0's entries a view opens: one root per placement without a tree; with one, its top
 *  nodes, then the world DAG's root when it is packed. */
fn rootSlots()->u32{
 let world=select(0u,1u,views[0u].worldRoot!=0xffffffffu);
 return select(views[0u].worldCount,views[0u].treeTop+world,hasTree());
}
/** The one gate of a placement's root, whoever opens it — \`dagPrepare\` an ungrouped one, its kept
 *  group a member (\`placementStep\`): parked, drawn by its impostor card, or drawn by the world DAG
 *  in its place (\`worldCovers\`), it opens nothing. */
fn opensRoot(w:u32)->bool{return rootOf(w)!=0xffffffffu&&(markOf(w)&${CARD_ROOT}u)==0u&&!worldCovers(w);}
/** Placement \`w\`'s root, at entry \`at\` of queue 0 under the view \`vi\`, or none; the placement
 *  prepared either way. */
fn openRoot(at:u32,w:u32){
 setFlag(queueBase(0u)+at,select(0xffffffffu,packEntry(vi,rootOf(w)),opensRoot(w)));
 preparePlacement(w);
}
/** \`dagPrepare\`'s thread \`i\` of the bound range, with a tree: the head range writes its top
 *  nodes, the world DAG's range that root behind them. */
fn prepareTreeRoots(i:u32){
 let top=select(0u,views[0u].treeTop,rangeFirst()==0u);
 if(i<top){setFlag(queueBase(0u)+i,packEntry(0u,views[0u].cellBase+i));return;}
 let w=views[0u].worldRoot;
 if(i==top&&w!=0xffffffffu&&inRange(w)){vi=0u;openRoot(views[0u].treeTop,w);}
}
/** What \`dagPrepare\` derives for placement \`w\` under the camera: its planes in its slot, its
 *  \`view·world\`, its normal matrix and the view ahead's (\`preparePrimitive\`). */
fn preparePlacement(w:u32){
 let pose=worldPose(w);let m=transpose(pose);deformReach=reachOf(w);
 // A primitive a camera never culls (\`unculledOf\`) takes six planes no box leaves.
 let open=unculledOf(w);
 putPlanes(slotOf(w)*FRAME,m,vi,open);preparePrimitive(w,pose,m,open);
}
`

/** The tree's share of the level descent (\`levelWgsl.ts\`), its \`queues\` in rotation. */
export const treeDescentWgsl = (queues: number) => `const TREE_GROUP:u32=${TREE_GROUP}u;
/** Member \`k\` of the tree's order (\`members\`, behind the cold records), deposited by its kept group
 *  under the view \`vi\`: its placement prepared, then its root tested as pass 0 tests an ungrouped
 *  one, unless its gate closes it (\`opensRoot\`). */
fn placementStep(src:u32,k:u32){
 let w=coldAt(views[0u].members+k);
 if(w==0xffffffffu||!inRange(w)||!opensRoot(w)){return;}
 let view=vi;vi=0u;preparePlacement(w);vi=view;
 nodeStep(src,rootOf(w));
}
/** A cell or a group of the tree: its world box under the camera, then under the view ahead. Its
 *  world is the first (\`NODE_WORLD\`), so one range's dispatch reads it. */
fn treeStep(src:u32,node:CullNode){
 if(!inRange(node.worldIndex)){return;}
 deformReach=0.0;
 let lo=node.minimum-views[0u].cameraWorld;let hi=node.maximum-views[0u].cameraWorld;
 if(aheadOn()&&vi==AHEAD_VIEW){if(!outsideView(AHEAD_VIEW,lo,hi)){descendTree(src,node);}return;}
 if(outsideView(0u,lo,hi)){
  atomicAdd(&out.frustumRejected,1u);
  if(aheadOn()&&!outsideView(AHEAD_VIEW,lo,hi)){vi=AHEAD_VIEW;descendTree(src,node);}
  return;
 }
 descendTree(src,node);
}
/** View \`v\`'s frustum test of a render-frame box, as \`outsideFrustum\` tests a primitive's: an
 *  infinite far plane (a NaN plane, \`farless\`) rejects nothing. */
fn outsideView(v:u32,lo:vec3f,hi:vec3f)->bool{
 let noFar=(bitcast<u32>(views[v].planes[FAR_PLANE].x)&0x7fffffffu)>0x7f800000u;
 for(var i=0u;i<6u;i++){if((i!=FAR_PLANE||!noFar)&&outsidePlane(views[v].planes[i],lo,hi)){return true;}}
 return false;
}
/** A kept cell opens its groups, a kept group its placements, in the next queue. */
fn descendTree(src:u32,node:CullNode){
 let first=select(node.firstChild,views[0u].nodeCount+node.firstChild,node.kind==TREE_GROUP);
 queueAppend((src+1u)%${queues}u,first,node.childCount);
}
`
