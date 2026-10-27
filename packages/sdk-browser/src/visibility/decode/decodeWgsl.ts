import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS_WGSL,
} from '../../gpu/dispatch/grid.ts'
import { VISIBLE_LAYOUT_WGSL } from '../../geometry/dag/visible/layout.ts'
import { CLUSTER_INFO } from '../../geometry/dag/info/clusterInfoLayout.ts'
import {
  NO_OUTPUTS,
  PLACEMENT_EVALUATE,
  PLACEMENT_HLOD_SHIFT,
  PLACEMENT_HOLDOUT,
  PLACEMENT_INFO,
  PLACEMENT_PAGE_MARKS,
  PLACEMENT_VELOCITY,
} from '../../geometry/dag/info/placementInfoLayout.ts'
import { DIAGNOSTIC_DRAWN_AS_WGSL } from '../../diagnostic/colors.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../shader/pageWgsl.ts'
import { VIS_TRIANGLE_BITS } from '../visWords.ts'
import { FLAG_HOLDOUT, WPO_ROW_ALWAYS, WPO_ROW_VELOCITY } from '../types.ts'
import { VIS_WORK_WGSL } from './contract.ts'

/** The decode's bindings, group 0, in their order: the list of visible clusters, the cluster
 *  records, the roots' worlds in doubles, the placements' records and the deformed results of their
 *  pages, then what it writes: the decoded clusters and the work buffer. Seven storage buffers. */
const DECODE_BINDING = {
  visible: 0,
  info: 1,
  rootWorlds: 2,
  placements: 3,
  outputs: 4,
  pages: 5,
  work: 6,
} as const
const B = DECODE_BINDING

/** The plan's bindings, group 0 of its own layout: the list of visible clusters it reads, the work
 *  buffer it writes the ranges to and the dispatch arguments (`DECODE_ARGS_BYTES`) it writes alone,
 *  so that no dispatch reads its arguments from a buffer its own group binds writable. */
const PLAN_BINDING = { visible: 0, work: 1, args: 2 } as const

const DECODE_STRUCTS = wgslBlock(
  'DECODE_STRUCTS',
  [],
  `${CLUSTER_INFO.wgsl}\n${PLACEMENT_INFO.wgsl}\n${wgslConsts({ NO_OUTPUTS, FLAG_HOLDOUT, PLACEMENT_EVALUATE, PLACEMENT_HOLDOUT, PLACEMENT_PAGE_MARKS, PLACEMENT_VELOCITY, PLACEMENT_HLOD_SHIFT, WPO_ROW_ALWAYS, WPO_ROW_VELOCITY, ROOT_WORLD_VALUES: MATRIX_VALUES })}`,
)

/**
 * THE PLAN OF THE DECODE, `decodePlan` then `deformPlan`, two one-thread kernels of their own layout
 * (`PLAN_BINDING`) — the dispatch arguments they write may not be bound by the group of the dispatch
 * that reads them.
 *
 * `decodePlan` reads the list's header and writes the ranges of the pass (`RANGE`, `./contract.ts`):
 * the software clusters and the hardware ones it lists, both counts held to the list's room so that
 * neither runs into the other, the main pass's those listed before the cut's post pass opened
 * (`VIS_SW_SPLIT`), the post pass's the rest — none in a cut of one pass —, and the dispatch of the
 * decode and of the bins over them (`decodeArgsAt`); it also empties the deformation's list and, in
 * the main pass, the tally of the instances the hardware slots reserve.
 *
 * `deformPlan`, once the decode ran, writes the dispatch of the deformation over the clusters the
 * decode listed for it: a workgroup each.
 */
export const decodePlanSource = () =>
  wgslProgram(
    `@group(0) @binding(${PLAN_BINDING.visible}) var<storage,read> visible:array<u32>;
@group(0) @binding(${PLAN_BINDING.work}) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(${PLAN_BINDING.args}) var<storage,read_write> args:array<u32>;
/** The pass this pipeline plans: the main pass's or the post pass's (0 or 1). */
override PASS:u32;
/** Records the list holds room for. */
fn capacity()->u32{return (arrayLength(&visible)-VISIBLE_HEADER_WORDS)/VISIBLE_RECORD_WORDS;}
@compute @workgroup_size(1) fn decodePlan(){
 let cap=capacity();
 let sw=min(visible[VIS_SW],cap);
 let hw=min(visible[VIS_HW],cap-sw);
 let swSplit=visible[VIS_SW_SPLIT];let hwSplit=visible[VIS_HW_SPLIT];
 var swFirst=0u;var swCount=sw;var hwFirst=cap-hw;var hwCount=hw;
 if(PASS==0u){
  swCount=min(sw,swSplit);hwCount=min(hw,hwSplit);hwFirst=cap-hwCount;
 }else if(swSplit==NO_SPLIT){
  swCount=0u;hwCount=0u;
 }else{
  swFirst=min(sw,swSplit);swCount=sw-swFirst;hwCount=hw-min(hw,hwSplit);
 }
 let at=PASS*RANGE_WORDS;
 atomicStore(&work[at+RANGE_SW_FIRST],swFirst);atomicStore(&work[at+RANGE_SW_COUNT],swCount);
 atomicStore(&work[at+RANGE_HW_FIRST],hwFirst);atomicStore(&work[at+RANGE_HW_COUNT],hwCount);
 let grid=groupGrid(ceilDiv(swCount+hwCount,WORKGROUP_THREADS));
 let to=PASS*DECODE_ARGS_WORDS;
 args[to]=grid.x;args[to+1u]=grid.y;args[to+2u]=1u;
 atomicStore(&work[DEFORM_COUNT],0u);
 if(PASS==0u){atomicStore(&work[INSTANCE_TOTAL],0u);}
}
@compute @workgroup_size(1) fn deformPlan(){
 let grid=groupGrid(atomicLoad(&work[DEFORM_COUNT]));
 atomicStore(&work[DEFORM_GROUPS],grid.x);atomicStore(&work[DEFORM_GROUPS+1u],grid.y);
 atomicStore(&work[DEFORM_GROUPS+2u],1u);
}`,
    [VISIBLE_LAYOUT_WGSL, VIS_WORK_WGSL, ceilDivWgsl, GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL],
  )

/** The decode's bindings, the world of a root, the empty record. */
const DECODE_BINDINGS_TEXT = `@group(0) @binding(${B.visible}) var<storage,read> visible:array<u32>;
@group(0) @binding(${B.info}) var<storage,read> info:array<ClusterInfo>;
@group(0) @binding(${B.rootWorlds}) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(${B.placements}) var<storage,read> placements:array<PlacementInfo>;
@group(0) @binding(${B.outputs}) var<storage,read> outputs:array<u32>;
@group(0) @binding(${B.pages}) var<storage,read_write> pages:array<PageInfo>;
@group(0) @binding(${B.work}) var<storage,read_write> work:array<atomic<u32>>;
/** The pass this pipeline decodes: 0 for the main pass, 1 for the post pass. */
override PASS:u32;
/** The world of root \`w\` in single precision, as the columns of its matrix. */
fn worldOf(w:u32)->mat4x4f{
 let at=w*ROOT_WORLD_VALUES;
 var c:array<vec4f,4>;
 for(var k=0u;k<4u;k++){
  c[k]=vec4f(
   bitcast<f32>(toF32(rootWorlds[at+4u*k])),bitcast<f32>(toF32(rootWorlds[at+4u*k+1u])),
   bitcast<f32>(toF32(rootWorlds[at+4u*k+2u])),bitcast<f32>(toF32(rootWorlds[at+4u*k+3u])));
 }
 return mat4x4f(c[0],c[1],c[2],c[3]);
}
/** The record of a cluster this pass does not decode, left drawing nothing and deforming nothing:
 *  the slot keeps what an earlier image put there, which no scan of the table may take for this one's. */
fn leaveEmpty(v:u32){pages[v].indexCount=0u;pages[v].deformOutput=0u;}
`

/** The decode kernel: a cluster's record from its placement. */
const DECODE_KERNEL_TEXT = `@compute @workgroup_size(WORKGROUP_THREADS) fn decode(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let t=flatIndex(id,n,WORKGROUP_THREADS);
 let at=PASS*RANGE_WORDS;
 let swCount=atomicLoad(&work[at+RANGE_SW_COUNT]);
 if(t>=swCount+atomicLoad(&work[at+RANGE_HW_COUNT])){return;}
 let v=select(atomicLoad(&work[at+RANGE_HW_FIRST])+(t-swCount),atomicLoad(&work[at+RANGE_SW_FIRST])+t,t<swCount);
 let r=VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*v;
 if((visible[r+2u]&VIS_TAG_BLENDED)!=0u){leaveEmpty(v);return;}
 let i=visible[r];let w=visible[r+1u];
 if((w+1u)*ROOT_WORLD_VALUES>arrayLength(&rootWorlds)||w>=arrayLength(&placements)){leaveEmpty(v);return;}
 let p=placements[w];
 let c=info[i+p.infoShift];
 var page:PageInfo;
 page.world=worldOf(w);
 page.flags=c.flags|select(0u,FLAG_HOLDOUT,(p.switches&PLACEMENT_HOLDOUT)!=0u);
 page.marks=p.switches&PLACEMENT_PAGE_MARKS;
 page.pageOffset=c.pageOffset;
 page.indexCount=c.indexCount;
 page.vertexBase=c.vertexBase;
 page.packedBase=(v+1u)<<${VIS_TRIANGLE_BITS}u;
 page.clusterHash=c.clusterHash;
 page.selectionIndex=i;
 page.diagnosticWord=diagnosticDrawnAs(c.diagnosticWord,p.switches>>PLACEMENT_HLOD_SHIFT);
 page.depthBias=c.depthBias;
 page.placement=w;
 page.materialClass=c.materialClass;
 page.deform=p.deform;
 page.deformCount=0u;
 page.deformOutput=0u;
 if(p.outputs!=NO_OUTPUTS){
  let o=p.outputs+2u*(i-p.pageBase);
  page.deformCount=outputs[o];
  page.deformOutput=outputs[o+1u];
 }
 page.material=c.material;
 let moves=c.wpo!=0u&&((p.switches&PLACEMENT_EVALUATE)!=0u||(c.wpo&WPO_ROW_ALWAYS)!=0u);
 page.wpo=select(0u,c.wpo|select(0u,WPO_ROW_VELOCITY,(p.switches&PLACEMENT_VELOCITY)!=0u),moves);
 page.wpoCentre=select(vec3f(0.0),p.wpoCentre,moves);
 page.wpoDisableSq=select(0.0,p.wpoDisableSq,moves);
 page.wpoMost=select(0.0,max(p.wpoMost,c.wpoMost),moves);
 pages[v]=page;
 if(page.deformOutput!=0u&&page.deformCount!=0u&&page.indexCount!=0u){
  let k=atomicAdd(&work[DEFORM_COUNT],1u);
  atomicStore(&work[DEFORM_LIST+k],v);
 }
}`

/**
 * THE DECODE OF THE VISIBLE CLUSTERS, `decode`, once a pass of the cut: the list of visible
 * clusters (`../../geometry/dag/visible/layout.ts`) holds a page, a placement and a tag a cluster;
 * the passes after it read a cluster's whole record (`PageInfo`, `../pageInfo.ts`) at its index in
 * the list, so the identifier a pixel carries — that index plus one, above the triangle's bits
 * (`../visWords.ts`) — names the record without a table of its own.
 *
 * A thread a cluster of the pass's ranges (`decodePlan`), it writes its record from three sources,
 * none a host table of drawn clusters: the cluster's own record (`ClusterInfo`: its slot, its
 * geometry, its surface — what no placement decides), its placement's world, which the GPU holds in
 * doubles and the record takes in single precision (`toF32`), and its placement's record
 * (`PlacementInfo`: its deformation, the switches of its object's offset, the HLOD level it draws
 * as, the deformed results of its pages). The offset's words are the surface's with the object's, as
 * the object says: zero when the object does not evaluate the surface's offset, unless the surface
 * always does. A blended cluster has no record here, the blend pass draws it from its own: its slot is left empty (`leaveEmpty`). A cluster
 * whose vertices a deformation moves is listed for the deformation, which runs between the decode
 * and the rasters (`../../deformation/computeWgsl.ts`).
 */
export const decodeSource = () =>
  wgslProgram(`${DECODE_BINDINGS_TEXT}${DECODE_KERNEL_TEXT}`, [
    PAGE_INFO_STRUCT_WGSL,
    DECODE_STRUCTS,
    VISIBLE_LAYOUT_WGSL,
    VIS_WORK_WGSL,
    DIAGNOSTIC_DRAWN_AS_WGSL,
    toF32,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
