import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { LEVEL_QUEUES } from './levelWgsl.ts'
import { CAMERA_DESCENT, postWords, type DescentShape } from './descentShape.ts'

/** The camera cut's post pass splits its visible clusters in two (`splitVisible`), the main pass's
 *  and its own. */
const SPLIT_VISIBLE = ` // The main pass's visible clusters as asked, past the cap too: what its peak reads (\`dagFinish\`).
 splitVisible();
`

/** The camera cut's post pass also judges the clusters it held, each by the pyramid (`drawCluster`). */
const POST_CLUSTERS = `/** Held cluster \`s\` judged by this pyramid: seen, drawn. */
fn postClusterStep(s:u32){
 let at=postClusterAt(s);
 let i=flagAt(at);let w=flagAt(at+1u);
 deformReach=reachOf(w);let r=recordOf(i,w);
 if(boxSight(boxMin(r),boxMax(r),w)==BOX_SEEN){drawCluster(i,w,r,clusterAt(r));return;}
 atomicAdd(&out.postHidden,1u);
}
/** Held cluster \`s\`, judged by this pyramid: seen, drawn; the triangles it draws summed in the
 *  workgroup (\`totalsWgsl.ts\`). */
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagPostClusters(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lid:u32){
 let s=flatIndex(id,n,WORKGROUP_THREADS);
 if(s<min(atomicLoad(&work[postClusterCounter()]),cutView.candCap)){postClusterStep(s);}
 flushTally(lid);
}
`

/**
 * THE POST PASS OF THE CUT: what the main pass held because the previous image's pyramid alone hid
 * it (`occlusionWgsl.ts`), judged again once the main pass's clusters are drawn and the pyramid is
 * rebuilt from them (`../../../visibility/passes/passes.ts`).
 *
 * `dagPostPrepare` opens it: the pass is told (`CUT_POST`), the candidates it writes start behind
 * the main pass's (`candFirst`), the visible clusters it writes behind the main pass's in each list
 * (`splitVisible`), the descent array starts empty.
 * `dagPostNodes` takes each entry held — the children of a node its parent held, the mask of them,
 * or a cell of the placement tree or a placement's root, alone —, each item of it in turn: its
 * frustum and its level of detail passed in the main pass, only the pyramid judges it now, the box
 * at its current pose; seen, it is accepted as the main pass would have (`acceptNode`), into queue
 * 0, and the levels that follow test its subtree in full, against this pyramid — a leaf seen asks
 * for its pages as the main pass's would have (`depositLeaf`); the leaves held below a root were
 * those with a resident page (`heldBack`). `dagPostClusters` takes each cluster held: the cut rule
 * drew it in the main pass, so seen now it is drawn (`drawCluster`). What this pyramid hides is gone
 * for this image, counted (`postHidden`).
 *
 * The post pass of `shape` (`descentShape.ts`): the camera cut's (`DAG_POST_PASS_WGSL`), or a views
 * descent's, whose held entries carry their view (`heldHere` says whether the running pass judges
 * it) and which holds no cluster of its own.
 */
export const dagPostPassWgsl = (shape: DescentShape) =>
  wgslBlock(
    shape.views ? 'DAG_POST_PASS_VIEWS_WGSL' : 'DAG_POST_PASS_WGSL',
    [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX],
    `@compute @workgroup_size(1)
fn dagPostPrepare(){
 atomicStore(&work[passWord()],CUT_POST);
 atomicStore(&work[candFirstWord()],min(atomicLoad(&work[candCounter()]),cutView.candCap));
${shape.views ? '' : SPLIT_VISIBLE} resetGrid(candGroups());
 for(var q=0u;q<${LEVEL_QUEUES}u;q++){
  atomicStore(&work[queueCounter(q)],0u);atomicStore(&work[queueStartWord(q)],0u);resetGrid(queueGroups(q));
 }
}
/** Held entry \`s\`: each of its items judged by this pyramid (\`postItem\`). */
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagPostNodes(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,WORKGROUP_THREADS);
 if(s>=min(atomicLoad(&work[postNodeCounter()]),queueEntries())){return;}
 let at=postNodeBase()+${postWords(shape)}u*s;
 let first=flagAt(at);let w=flagAt(at+1u);var mask=flagAt(at+2u);${shape.views ? '\n descentView=flagAt(at+3u);\n if(!heldHere(descentView)){return;}' : ''}
 while(mask!=0u){let b=firstTrailingBit(mask);mask&=mask-1u;postItem(first+b,w);}
}
/** Held item \`index\` of placement \`w\`, judged by this pyramid: seen, accepted into queue 0. */
fn postItem(index:u32,w:u32){
 if(hasTree()&&index>=cutView.cellBase){
  let t=index-cutView.cellBase;deformReach=0.0;
  if(boxSight(cellLow(t),cellHigh(t),NO_INDEX)==BOX_SEEN){queueAppend(0u,index,1u,0u);return;}
  atomicAdd(&out.postHidden,1u);
  return;
 }
 let node=nodeAt(index);deformReach=reachOf(w);
 if(boxSight(node.minimum,node.maximum,w)==BOX_SEEN){acceptNode(0u,index,node,w);return;}
 atomicAdd(&out.postHidden,1u);
}
${shape.views ? '' : POST_CLUSTERS}`,
  )

export const DAG_POST_PASS_WGSL = dagPostPassWgsl(CAMERA_DESCENT)
