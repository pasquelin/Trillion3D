import { TREE_GROUP } from '../placementTree.ts'
import { CARD_ROOT } from '../../../visibility/shader/spriteWgsl.ts'

/**
 * The placement tree in the descent (`../placementTree.ts`): cells, then instance groups,
 * then the placements a kept group holds, each level culled before the next one is read.
 *
 * A cell or a group is a world box tested against the frustum's render-frame planes, the eye taken
 * off it (`cameraWorld`), under the camera, then — rejected there — under the view ahead, as any
 * node (`aheadWgsl.ts`). A kept cell deposits its groups; a kept group deposits its members as
 * entries past the nodes (`nodeCount + k`, `k` a rank of the tree's order). The level that reads a placement's entry prepares it —
 * the planes and matrices `dagPrepare` derives, in the camera's slot (`preparePlacement`) — then
 * tests its root node in the same thread, so a placement no kept group holds costs nothing: no
 * planes, no matrix, no root test. `dagPrepare` leaves a grouped slot alone, save the tree's cell
 * of the same rank it deposits in queue 0 (`cellEntry`).
 */
export const DAG_TREE_PREPARE_WGSL = `/** Whether slot \`t\` is a grouped placement's (\`grouped\`): its group prepares it. */
fn groupedSlot(t:u32)->bool{return t%views[0u].worldCount<views[0u].grouped;}
/** What a grouped placement's slot \`t\` carries in queue 0: the cell of its rank, the camera's. */
fn cellEntry(t:u32)->u32{return select(0xffffffffu,packEntry(0u,views[0u].cellBase+t),t<views[0u].cells);}
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
 *  one. A parked row, a root its impostor card draws, or a placement the world DAG draws in its
 *  place (\`worldCovers\`) opens nothing and is not prepared. */
fn placementStep(src:u32,k:u32){
 let w=coldAt(views[0u].members+k);
 if(!inRange(w)){return;}
 let root=rootOf(w);
 if(root==0xffffffffu||(markOf(w)&${CARD_ROOT}u)!=0u||worldCovers(w)){return;}
 let view=vi;vi=0u;preparePlacement(w);vi=view;
 nodeStep(src,root);
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
