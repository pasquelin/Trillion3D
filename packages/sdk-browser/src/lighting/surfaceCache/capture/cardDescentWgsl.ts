import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { FLOAT32_MAX, NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { DRAW_MASK_ACCESS_WGSL } from '../../../geometry/dag/shader/drawMaskWgsl.ts'
import { casterReachWgsl, markReachWgsl } from '../../../deformation/halfFloat.ts'
import { worldWgsl } from '../../../geometry/dag/shader/worldPoseWgsl.ts'
import { DAG_AXIS_SCALES_WGSL } from '../../../geometry/dag/shader/primitiveWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { CLUSTER_NEVER, CLUSTER_TRANSPARENT } from '../../../geometry/dag/clusterFlags.ts'
import { CLUSTER_LAYOUT } from '../../../geometry/dag/layout.ts'
import { CLUSTER_INFO } from '../../../geometry/dag/info/clusterInfoLayout.ts'
import { VIEW_UNIFORM_STRUCT } from '../../../geometry/dag/viewLayout.ts'
import { VISIBLE_LAYOUT_WGSL } from '../../../geometry/dag/visible/layout.ts'
import { DAG_ACCESS_WGSL } from '../../../geometry/dag/shader/bindings.ts'
import { DAG_RECORD_WGSL } from '../../../geometry/dag/shader/recordWgsl.ts'
import { DAG_WORLD_GATE_WGSL } from '../../../geometry/dag/shader/worldGateWgsl.ts'
import { DAG_NO_GATES_WGSL } from '../../../geometry/dag/shader/noGatesWgsl.ts'
import { DAG_READING_WGSL } from '../../../geometry/dag/shader/snapshotWgsl.ts'
import { DAG_VIEWS_WGSL } from '../../../geometry/dag/shader/viewsWgsl.ts'
import { DAG_ARM_WGSL } from '../../../geometry/dag/shader/armWgsl.ts'
import { BLOCK_MASK_WORDS_WGSL, FRAME_COUNTERS } from '../../../geometry/dag/shader/floorWgsl.ts'
import { DAG_CUT_PASS_WGSL } from '../../../geometry/dag/shader/occlusionWgsl.ts'
import { dagLevelWgsl } from '../../../geometry/dag/shader/levelWgsl.ts'
import { dagListsWgsl } from '../../../geometry/dag/shader/listsWgsl.ts'
import {
  DAG_TREE_PREPARE_WGSL,
  dagTreeDescentWgsl,
} from '../../../geometry/dag/shader/placementTreeWgsl.ts'
import {
  CULL_NODE_STRUCT,
  DAG_OUTPUT_STRUCT,
  DAG_PRIMITIVE_READS,
} from '../../../geometry/dag/shader/shader.ts'
import { requestPriorityOf } from '../../../geometry/dag/shader/error.ts'
import type { DescentShape } from '../../../geometry/dag/shader/descentShape.ts'
import { CAND_WORDS } from '../../../geometry/dag/flagSections.ts'
import { CUT_RULE_WGSL } from '../../../geometry/cut/rule.ts'
import { FLAG_LINE, FLAG_SPRITE, FLAG_VOXEL } from '../../../visibility/types.ts'
import {
  CARD_TABLE_HEAD,
  CARD_VIEW,
  CARD_VIEW_READ_WGSL,
  CARD_VIEW_WORDS,
} from './cardViewTable.ts'

/**
 * THE DESCENT AND THE CULL OF THE CARDS' VIEWS. An image of the surface cache draws the pages of
 * many cards, each from a view of its own (`cardViewTable.ts`): one level-by-level descent of the cut's
 * hierarchy (`../../../geometry/dag/shader/levelWgsl.ts`, the camera's and the shadow views' own
 * kernels) runs over the list of those views, each view opening the root of the one placement whose
 * mesh its card belongs to — a card is captured from its own mesh alone — and testing a node against
 * the view's box: the placement's box in the page's clip space, which an orthographic view keeps
 * as a box (`cardBoxOutside`), the card's volume. A node whose subtree replaces an error that spans
 * no more than the threshold in the view's pixels is not opened (`cardNeeded`), as a map's view of
 * the shadows judges it. A leaf kept asks the streaming for its pages and lists the pages that are
 * resident, each once (`candAppend`).
 *
 * The cull then takes the listed pages (`cardEmit`), a thread a page: every cluster of the page is
 * judged against each view of its placement — the run of the table's records its placement ranks
 * (`cardFirstView`) —, by the cut rule on the errors it projects in that view's pixels
 * (`drawsCompared`), and, kept, joins the list of visible clusters in the layout the decode reads
 * (`../../../geometry/dag/visible/layout.ts`: a page, a placement, and as its tag the view that draws
 * it). A cluster is one record for each view that draws it; its decoded row is that view's alone. No
 * pyramid hides a box (a card is drawn whole, its view sees no other), the main view's filter and draw
 * distances do not apply (a card is a property of its mesh), the world's switch does: an actor of the
 * world DAG whose cell the cut does not draw is not captured.
 *
 * Group 0: the cut's tables at the culling's bindings, the list of visible clusters among them
 * (`visible`, the cull's output). Group 1: 0 the parameters, 1 the table of views (its head: the rows
 * the image holds), 2 the counters.
 */

/** The parameters of the descent and the cull. */
export const CARD_PARAMS = fieldLayout('CardParams', [
  ['views', 'u32'],
  ['rowCap', 'u32'],
  ['threshold', 'f32'],
  ['pad', 'u32'],
] as const)

/** The counters (`counts`): the pages the descent listed, the clusters the cull emitted, and from `args`
 *  the dispatch of the rasters over them, a workgroup a cluster. A node, a page or a record past its
 *  budget is dropped, and nothing counts it. */
export const CARD_COUNT = { listed: 0, rows: 1, args: 4 } as const

/** The counters' words: the dispatch's three come last. */
export const CARD_COUNT_WORDS = CARD_COUNT.args + 3

/** The card views' descent (`../../../geometry/dag/shader/descentShape.ts`). */
export const CARD_DESCENT_SHAPE: DescentShape = {
  views: true,
  begin: '',
  subtreeNeeded: 'cardNeeded(node,w)',
  cameraSubtree: false,
  floor: 'none',
  cellOutside: 'cardCellOutside',
  priority: 'cardPriority(node,w)',
  resets: '',
}

/** The kernels' entry points. */
export const CARD_DESCENT_ENTRY = {
  prepare: 'cardDescentPrepare',
  levels: ['dagLevel0', 'dagLevel1', 'dagLevel2'],
  close: 'cardDescentClose',
  arm: 'dagArm',
  emit: 'cardEmit',
  done: 'cardEmitDone',
} as const

const declarations = () => /* wgsl */ `${CLUSTER_LAYOUT.wgsl}
${CLUSTER_INFO.wgsl}
${CULL_NODE_STRUCT}
${VIEW_UNIFORM_STRUCT}
${DAG_OUTPUT_STRUCT}
${DAG_PRIMITIVE_READS}
${CARD_PARAMS.wgsl}
@group(1) @binding(0) var<uniform> params:CardParams;
@group(1) @binding(1) var<storage,read_write> table:array<u32>;
@group(1) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
${wgslConsts({
  CARD_TABLE_HEAD,
  CARD_VIEW_WORDS,
  CARD_COUNT_LISTED: CARD_COUNT.listed,
  CARD_COUNT_ROWS: CARD_COUNT.rows,
  CARD_COUNT_ARGS: CARD_COUNT.args,
  CARD_CLUSTER_NEVER: CLUSTER_NEVER | CLUSTER_TRANSPARENT,
  CARD_ROW_SKIPPED: FLAG_LINE | FLAG_SPRITE | FLAG_VOXEL,
  CARD_CAND_WORDS: CAND_WORDS,
})}
/** The descent's \`work\`: the frame counters first (\`counterBase\`), then the pages' mask, a bit a packed
 *  page, which lists a page once (\`candAppend\`), a block of \`BLOCK_MASK_WORDS\` words a workgroup's
 *  pages. */
fn counterBase()->u32{return 0u;}
fn drawMaskBase()->u32{return ${FRAME_COUNTERS}u;}
fn descentViews()->u32{return params.views;}
`

const viewsText = /* wgsl */ `
/** Word \`k\` of view \`v\`'s record. */
fn cardWord(v:u32,k:u32)->u32{return table[CARD_TABLE_HEAD+v*CARD_VIEW_WORDS+k];}
/** The rank of the placement view \`v\` draws, and the pixels it spans a metre. */
fn cardPlace(v:u32)->u32{return cardWord(v,${CARD_VIEW.at.place}u);}
fn cardPixelsPerMetre(v:u32)->f32{return bitcast<f32>(cardWord(v,${CARD_VIEW.at.lod}u));}
/** The first view of placement \`w\` in the table, which is laid in the order of its placements. */
fn cardFirstView(w:u32)->u32{
 var lo=0u;var hi=params.views;
 while(lo<hi){
  let mid=(lo+hi)/2u;
  if(cardPlace(mid)<w){lo=mid+1u;}else{hi=mid;}
 }
 return lo;
}
/** Whether view \`v\` does not hold the box \`lo\`..\`hi\` of a placement of pose \`pose\`,
 *  grown by \`reach\`: the box carried to the view's clip space, an orthographic one's box
 *  [-1, 1] × [-1, 1] × [0, 1] the card's volume. */
fn cardBoxOutside(v:u32,pose:mat4x4f,lo:vec3f,hi:vec3f,reach:f32)->bool{
 let m=cardMatrix(v)*pose;
 let c=(lo+hi)*0.5;let h=(hi-lo)*0.5+vec3f(reach);
 let centre=(m*vec4f(c,1.0)).xyz;
 let extent=abs(m[0].xyz)*h.x+abs(m[1].xyz)*h.y+abs(m[2].xyz)*h.z;
 let slack=vec3f(1.0e-3);
 return any(centre+extent<vec3f(-1.0,-1.0,0.0)-slack)||any(centre-extent>vec3f(1.0)+slack);
}
`

const hooksText = /* wgsl */ `
/** Whether the running entry's view does not hold the box \`lo\`..\`hi\` of placement \`w\`. */
fn outsideFrustum(w:u32,lo:vec3f,hi:vec3f)->bool{return cardBoxOutside(descentView,worldsWorld(w),lo,hi,deformReach);}
/** The pixels an error of placement \`w\` spans in the running entry's view: the error at the placement's smallest axis
 *  scale (\`minAxisScale\`), as the camera's cut and the shadow maps' take it. */
fn cardPixels(w:u32,error:f32)->f32{return error*minAxisScale(worldsLinear(w))*cardPixelsPerMetre(descentView);}
/** Whether the running entry's view needs the error \`node\`'s subtree replaces: it spans more than the
 *  threshold, or none bounds it. */
fn cardNeeded(node:CullNode,w:u32)->bool{
 if(node.maxParentError<0.0){return true;}
 return cardPixels(w,node.maxParentError)>params.threshold;
}
/** A kept leaf's request priority: the reach of the error its pages replace over the threshold. */
fn cardPriority(node:CullNode,w:u32)->u32{
 let reach=select(FLOAT32_MAX,cardPixels(w,node.maxParentError)/max(params.threshold,1e-30),node.maxParentError>=0.0);
 return ${requestPriorityOf(0, 'reach')};
}
/** The tree is never descended (the table says no top level): no cell is out of a view. */
fn cardCellOutside(lo:vec3f,hi:vec3f)->bool{return false;}
/** No pyramid hides a box in a card's view. */
fn boxSight(lo:vec3f,hi:vec3f,w:u32)->u32{return BOX_SEEN;}
`

const descentKernelsText = /* wgsl */ `
/** The descent's reset and queue 0: the readout's counters, the lists', the pages' mask; then each view's
 *  root, a thread a view, which opens the root of its placement unless the world's switch closes it. */
@compute @workgroup_size(WORKGROUP_THREADS) fn ${CARD_DESCENT_ENTRY.prepare}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,WORKGROUP_THREADS);
 if(i==0u){
  atomicStore(&out.count,0u);atomicStore(&out.overflow,0u);atomicStore(&out.occluded,0u);atomicStore(&out.postHidden,0u);
  atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);resetCounters();
 }
 if(i<blockCount()){for(var k=0u;k<BLOCK_MASK_WORDS;k++){atomicStore(&work[drawMaskBase()+BLOCK_MASK_WORDS*i+k],0u);}}
 if(i>=params.views){return;}
 descentView=i;
 let w=cardPlace(i);
 putEntry(0u,select(NO_INDEX,rootOf(w)|ENTRY_TEST,w!=NO_INDEX&&rootOf(w)!=NO_INDEX&&!worldCovers(w)),w);
}
/** Once the descent ran: the pages it listed (held to the room) for the cull, and the clusters found so far, none. */
@compute @workgroup_size(1) fn ${CARD_DESCENT_ENTRY.close}(){
 atomicStore(&counts[CARD_COUNT_LISTED],min(atomicLoad(&work[candCounter()]),cutView.candCap));
 atomicStore(&counts[CARD_COUNT_ROWS],0u);
}
`

const emitText = /* wgsl */ `
/** Cluster \`i\` of placement \`w\` against each view of the placement: it joins the list of visible
 *  clusters once for every view that draws it. */
fn cardEmitPage(i:u32,w:u32){
 let r=recordOf(i,w);
 let cluster=clusterAt(r);
 if((cluster.flags&CARD_CLUSTER_NEVER)!=0u){return;}
 let n=infoOf(i,w);
 if(n>=arrayLength(&info)){return;}
 let record=info[n];
 if(record.indexCount==0u||(record.flags&CARD_ROW_SKIPPED)!=0u){return;}
 if(!worldDraws(i,w)){return;}
 let reach=casterReach(markReach(markOf(w)));
 var lo=boxMin(r);var hi=boxMax(r);
 if(hasBox(r)==0.0){
  lo=cluster.sphere.xyz-vec3f(cluster.sphere.w);
  hi=cluster.sphere.xyz+vec3f(cluster.sphere.w);
 }
 let pose=worldsWorld(w);
 let scale=minAxisScale(worldsLinear(w));
 let childIn=childResident(i);
 var v=cardFirstView(w);
 while(v<params.views&&cardPlace(v)==w){
  let view=v;
  v++;
  if(cardBoxOutside(view,pose,lo,hi,reach)){continue;}
  let ppm=cardPixelsPerMetre(view);
  let parentAbove=cluster.parentError<0.0||cluster.parentError*scale*ppm>params.threshold;
  let ownWithin=cluster.lodError*scale*ppm<=params.threshold;
  if(!drawsCompared(true,parentAbove,ownWithin,childIn)){continue;}
  let slot=atomicAdd(&counts[CARD_COUNT_ROWS],1u);
  if(slot>=params.rowCap){continue;}
  let at=VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*slot;
  atomicStore(&visible[at],i);
  atomicStore(&visible[at+1u],w);
  atomicStore(&visible[at+2u],view);
 }
}
/** A thread a page the descent listed (the candidates, behind the descent array). */
@compute @workgroup_size(WORKGROUP_THREADS) fn ${CARD_DESCENT_ENTRY.emit}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let k=flatIndex(id,n,WORKGROUP_THREADS);
 if(k>=atomicLoad(&counts[CARD_COUNT_LISTED])){return;}
 let at=candBase()+CARD_CAND_WORDS*k;
 cardEmitPage(flagAt(at),flagAt(at+1u));
}
/** The list closed: the header the decode reads (all software clusters, no post pass), the rows the
 *  image holds in the table's head, and the dispatch of the rasters, a workgroup a row. */
@compute @workgroup_size(1) fn ${CARD_DESCENT_ENTRY.done}(){
 let rows=min(atomicLoad(&counts[CARD_COUNT_ROWS]),params.rowCap);
 atomicStore(&visible[VIS_SW],rows);
 atomicStore(&visible[VIS_HW],0u);
 atomicStore(&visible[VIS_SW_SPLIT],NO_SPLIT);
 atomicStore(&visible[VIS_HW_SPLIT],NO_SPLIT);
 table[0]=rows;
 let g=groupGrid(rows);
 atomicStore(&counts[CARD_COUNT_ARGS],g.x);
 atomicStore(&counts[CARD_COUNT_ARGS+1u],g.y);
 atomicStore(&counts[CARD_COUNT_ARGS+2u],1u);
}
`

/** The card views' descent and cull. */
export const cardDescentWgsl = () =>
  wgslProgram(`${declarations()}${viewsText}${hooksText}${descentKernelsText}${emitText}`, [
    DAG_ACCESS_WGSL,
    DAG_RECORD_WGSL,
    dagLevelWgsl(CARD_DESCENT_SHAPE),
    dagListsWgsl(CARD_DESCENT_SHAPE),
    dagTreeDescentWgsl(CARD_DESCENT_SHAPE),
    DAG_TREE_PREPARE_WGSL,
    DAG_WORLD_GATE_WGSL,
    DAG_NO_GATES_WGSL,
    CARD_VIEW_READ_WGSL,
    DAG_CUT_PASS_WGSL,
    BLOCK_MASK_WORDS_WGSL,
    DAG_READING_WGSL,
    DAG_VIEWS_WGSL,
    DAG_ARM_WGSL,
    CUT_RULE_WGSL,
    VISIBLE_LAYOUT_WGSL,
    markReachWgsl,
    casterReachWgsl,
    worldWgsl('worlds'),
    DAG_AXIS_SCALES_WGSL,
    FLOAT32_MAX,
    NO_INDEX,
    DRAW_MASK_ACCESS_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
