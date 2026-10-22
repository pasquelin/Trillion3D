import { FAR_PLANE_SLOT } from '../../../../../math/src/geometry/frustum/frustum.ts'
import { DAG_WORLD_POSE_WGSL } from './worldPoseWgsl.ts'
import { DAG_ACCESS_WGSL, DAG_BINDINGS_WGSL } from './bindings.ts'
import { DAG_ERROR_WGSL } from './error.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { boxBehindPlane } from '../../../../../math/src/wgsl/geometry.ts'
import { isNanWord } from '../../../../../math/src/wgsl/integer.ts'
import { DAG_COMPACT_WGSL } from './compactWgsl.ts'
import { DAG_COMMIT_WGSL } from './commitWgsl.ts'
import { DAG_TOTALS_WGSL } from './totalsWgsl.ts'
import { DAG_READING_WGSL } from './snapshotWgsl.ts'
import { DAG_DIFFERENCE_WGSL } from './differenceWgsl.ts'
import { DAG_SWAP_WGSL } from './swapWgsl.ts'
import { DAG_WANTED_WGSL } from './wantedWgsl.ts'
import { DAG_LIVE_WGSL } from './liveWgsl.ts'
import { DAG_LEVEL_WGSL } from './levelWgsl.ts'
import { DAG_DRAW_DISTANCE_WGSL } from './drawDistanceWgsl.ts'
import { DAG_ROOT_PARENT_WGSL } from './rootParentWgsl.ts'
import { DAG_CLIP_PLANE_WGSL, DAG_NO_CLIP_PLANE_WGSL } from './clipPlaneWgsl.ts'
import { DAG_VIEW_FILTER_WGSL } from './viewFilterWgsl.ts'
import { DAG_LISTS_WGSL } from './listsWgsl.ts'
import { DAG_POST_PASS_WGSL } from './postPassWgsl.ts'
import { DAG_OCCLUSION_WGSL } from './occlusionWgsl.ts'
import { DAG_TREE_DESCENT_WGSL, DAG_TREE_PREPARE_WGSL } from './placementTreeWgsl.ts'
import { DAG_WORLD_GATE_WGSL } from './worldGateWgsl.ts'
import { BLOCK_MASK_WORDS_WGSL, DAG_FLOOR_WGSL } from './floorWgsl.ts'
import { DAG_HELD_OPEN_WGSL } from '../heldOpen.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { DAG_VIEWS_WGSL } from './viewsWgsl.ts'
import { DAG_RECORD_WGSL } from './recordWgsl.ts'
import { DAG_ARM_LISTS_WGSL, DAG_ARM_WGSL } from './armWgsl.ts'
import { ROW_CLOSURE_WGSL } from '../../rows/rowClosureWgsl.ts'
import { CUT_RULE_WGSL } from '../../cut/rule.ts'
import { CLUSTER_NEVER } from '../clusterFlags.ts'
import { DAG_PRIMITIVE_WGSL } from './primitiveWgsl.ts'
import { markReachWgsl } from '../../../deformation/halfFloat.ts'
import { VIEW_UNIFORM_STRUCT } from '../viewLayout.ts'
import { CLUSTER_LAYOUT } from '../layout.ts'

/** The selection kernel's text over the record tables `DAG_ACCESS_WGSL` reads. */
const DAG_SELECTION_TEXT = `${CLUSTER_LAYOUT.wgsl}
struct CullNode{minimum:vec3f,firstChild:u32,maximum:vec3f,maxParentError:f32,sphere:vec4f,worldIndex:u32,firstPage:u32,pageCount:u32,childCount:u32,minError:f32,open:u32,kind:u32,pad:u32,}
// \`view\` and \`planes\` are those of the render frame, whose origin is \`cameraWorld\` — the camera sits at zero
// there —; \`eye\` is that origin in doubles, which every translation a cut reads is taken off (\`worldPoseWgsl.ts\`).
// \`perspective\` is the projection's clip-w weight, 1 perspective and 0 orthographic; \`queueCap\` is the
// descent array's words, every level of a pass in it (\`../viewLayout.ts\`, \`listsWgsl.ts\`).
${VIEW_UNIFORM_STRUCT}
struct Output{count:atomic<u32>,frustumRejected:atomic<u32>,lodLevel:atomic<u32>,overflow:atomic<u32>,selectedTriangles:atomic<u32>,transparentTriangles:atomic<u32>,occluded:atomic<u32>,postHidden:atomic<u32>,pages:array<u32>,}
/** Rank of the far plane among the six (\`frustum.ts\`: right, left, bottom, top, far, near). */
const FAR_PLANE:u32=${FAR_PLANE_SLOT}u;
/** The plane the frustum test skips: the far plane when the view has none, else none (6). True when
 *  the view has no far plane: an infinite one reaches the kernel as a NaN plane (\`frustum.ts\`, zero
 *  normal normalized), which no comparison satisfies, and a NaN stays NaN through a placement's
 *  product. Read at the bit on the uniform, a NaN test no compiler folds. */
fn farSkip()->u32{return select(6u,FAR_PLANE,isNanWord(bitcast<u32>(views[0u].planes[FAR_PLANE].x)));}
/** A plane moved out by the primitive's deformation \`reach\` along every axis: a box clears it
 *  only if the box grown by that reach would — the oracle's \`growPlanes\`. */
fn grownPlane(p:vec4f,reach:f32)->vec4f{return vec4f(p.xyz,p.w+reach*(abs(p.x)+abs(p.y)+abs(p.z)));}
/** How far the current primitive's GPU deformation moves a vertex this frame, in its units
 *  (\`reachOf\`), set once the kernel knows which primitive it reads: every box and sphere grows by it. */
var<private> deformReach:f32;
/** The primitive's deformation reach, a half float in its mark's high sixteen bits (\`rootMark\`). */
fn reachOf(w:u32)->f32{return markReach(markOf(w));}
/** True on a primitive no camera culls (\`SPRITE_UNCULLED\`). */
fn unculledOf(w:u32)->bool{return (markOf(w)&${SPRITE_UNCULLED}u)!=0u;}
fn visible(r:u32,w:u32,cluster:Cluster)->bool{
 if((cluster.flags&${CLUSTER_NEVER}u)!=0u){return false;}
 return !outsideFrustum(w,boxMin(r),boxMax(r));
}
/** The main pass's reset and the descent's first entries in a single dispatch: the output counters
 *  and block counts \`dagMask\` accumulates, then queue 0. No placement is prepared: what a cut reads
 *  of one is made where it is read (\`primitiveWgsl.ts\`), and nothing is tested here — a thread
 *  writes its slot alone, no counter is contended for while thread 0 resets them.
 *  Without a placement tree, one thread per placement, its root to be tested (\`openRoot\`). With
 *  one, the tree's top nodes and the world DAG's root alone (\`prepareTreeRoots\`): a member is its
 *  kept group's to deposit. */
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagPrepare(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,WORKGROUP_THREADS);
 if(i==0u){
  atomicStore(&out.count,0u);atomicStore(&out.overflow,0u);atomicStore(&out.occluded,0u);atomicStore(&out.postHidden,0u);
  atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);resetTotaux();resetCounters();
 }
 if(i<blockCount()){
  atomicStore(&work[blockBase()+i],0u);
  for(var k=0u;k<BLOCK_MASK_WORDS;k++){
   atomicStore(&work[drawMaskBase()+BLOCK_MASK_WORDS*i+k],0u);atomicStore(&work[postMaskBase()+BLOCK_MASK_WORDS*i+k],0u);
  }
 }
 if(hasTree()){prepareTreeRoots(i);return;}
 if(i>=views[0u].worldCount){return;}
 // The primitive's root opens the descent: one thread, one root, no counter to contend for, unless
 // its gate closes it (\`opensRoot\`).
 openRoot(i,i);
}
/** The draws of the running pass, a thread a live entry: each page's draw bit, its block's count and
 *  the triangle totals; the post pass's draws also in the post mask, which the second raster pass
 *  draws (\`postMaskBase\`, \`../../../visibility/passes/passes.ts\`). The drawn log is the live list's
 *  pages, copied when the cut commits (\`dagCommitMask\`). */
@compute @workgroup_size(WORKGROUP_THREADS)
fn dagMask(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lid:u32){
 // Totals are summed in the workgroup first (\`totalsWgsl.ts\`), so EVERY thread in the
 // group crosses the barrier: a thread with no cluster does not return early, it does nothing.
 let s=liveFirst()+flatIndex(id,n,WORKGROUP_THREADS);
 if(s<liveCount()){
  let i=liveAt(s);let r=recordOf(i,liveWorld(s));
  tallyDrawn(r,clusterAt(r).flags);
  // Drawn count of this page's block, held here rather than reread later page by page; its bit is
  // the draw mask every reader takes (\`compactWgsl.ts\`).
  atomicAdd(&work[blockBase()+i/WORKGROUP_THREADS],1u);atomicOr(&work[drawMaskWord(i)],drawBit(i));
  if(cutPass()==CUT_POST){atomicOr(&work[postMaskWord(i)],drawBit(i));}
 }
 flushTally(lid);
}
`

/** The `DAG_*_WGSL` fragments are this program's parts, which it lists all (`docs/MATHS.md`, "The
 *  WGSL library"), but for the clip plane's (`dagSelectionShader`). */
const DAG_SELECTION_PARTS = [
  DAG_ACCESS_WGSL,
  DAG_BINDINGS_WGSL,
  DAG_PRIMITIVE_WGSL,
  DAG_WORLD_POSE_WGSL,
  DAG_ERROR_WGSL,
  CUT_RULE_WGSL,
  DAG_COMPACT_WGSL,
  DAG_COMMIT_WGSL,
  DAG_TOTALS_WGSL,
  DAG_READING_WGSL,
  DAG_DIFFERENCE_WGSL,
  DAG_SWAP_WGSL,
  DAG_WANTED_WGSL,
  DAG_LIVE_WGSL,
  DAG_LEVEL_WGSL,
  DAG_DRAW_DISTANCE_WGSL,
  DAG_ROOT_PARENT_WGSL,
  DAG_VIEW_FILTER_WGSL,
  DAG_LISTS_WGSL,
  DAG_POST_PASS_WGSL,
  DAG_OCCLUSION_WGSL,
  DAG_TREE_DESCENT_WGSL,
  DAG_TREE_PREPARE_WGSL,
  DAG_WORLD_GATE_WGSL,
  DAG_FLOOR_WGSL,
  BLOCK_MASK_WORDS_WGSL,
  DAG_HELD_OPEN_WGSL,
  FLAT_INDEX_WGSL,
  WORKGROUP_THREADS_WGSL,
  DAG_VIEWS_WGSL,
  DAG_RECORD_WGSL,
  DAG_ARM_WGSL,
  DAG_ARM_LISTS_WGSL,
  ROW_CLOSURE_WGSL,
  boxBehindPlane,
  isNanWord,
  markReachWgsl,
]

/** The selection kernel; `clipPlane`, the project switch (`cutClipPlane`) is on: the cut then culls
 *  by a view's clip plane (`DAG_CLIP_PLANE_WGSL`), else its text holds none of that code
 *  (`DAG_NO_CLIP_PLANE_WGSL`). */
export const dagSelectionShader = (clipPlane: boolean) =>
  wgslProgram(DAG_SELECTION_TEXT, [
    ...DAG_SELECTION_PARTS,
    clipPlane ? DAG_CLIP_PLANE_WGSL : DAG_NO_CLIP_PLANE_WGSL,
  ])

/** The kernel of a session whose project switch is off. */
export const DAG_SELECTION_SHADER = dagSelectionShader(false)
