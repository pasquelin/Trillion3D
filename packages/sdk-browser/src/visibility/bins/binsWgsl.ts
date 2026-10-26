import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { DEPTH_LAYER_BIAS_UNITS } from '../../../../sdk-core/src/lod/depthLayer.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS_WGSL,
} from '../../gpu/dispatch/grid.ts'
import { VISIBLE_LAYOUT_WGSL } from '../../geometry/dag/visible/layout.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../shader/pageWgsl.ts'
import { VIS_WORK_WGSL } from '../decode/contract.ts'
import { FLAG_BACK, FLAG_DOUBLE, FLAG_MASK, FLAG_VOXEL } from '../types.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import {
  DEPTH_BUCKETS,
  LIST_AT,
  LIST_COUNT,
  LIST_DISPATCH,
  LIST_ROWS,
  LIST_TESS_AT,
  LIST_TESS_COUNT,
  LIST_TESS_DISPATCH,
  headerWord,
  RASTER_PASS_POST,
} from '../raster/contract.ts'
import {
  BASE_SLOTS,
  BATCH_SHIFT,
  BIN_BACK,
  BIN_FRONT,
  BIN_KIND,
  BIN_NONE,
  BIN_UNIFORM_BYTES,
  CULL_BINS,
  HALF_SLOTS,
  binGroups,
  binScratch,
  slotCount,
} from './contract.ts'

/** The bins' bindings, group 0, in their order: the decoded clusters, the list of visible clusters,
 *  the work buffer, the three outputs of the hardware raster — its instances, its commands, where
 *  each slot starts — the software raster's and the tessellation's lists, and the uniform. Seven
 *  storage buffers. */
const BIN_BINDING = {
  pages: 0,
  visible: 1,
  work: 2,
  instances: 3,
  indirect: 4,
  slotOffsets: 5,
  lists: 6,
  uniform: 7,
} as const
const B = BIN_BINDING

/** The words of the bins' uniform (`BIN_UNIFORM_BYTES`), in order; the host writes them
 *  (`./bins.ts`): the corners an instance launches and the instances a cluster takes at most
 *  (`drawBatches`), whether the software raster's clusters are also binned to the hardware slots
 *  the x-ray view walks, the clusters the list holds room for, the instances the buffer holds, and
 *  where the bins' scratch lies in the work buffer. The depth bucket of a cluster is the cut's
 *  (`../../geometry/dag/shader/visibleWgsl.ts`, `depthBuckets`): the bins only read it from the tag. */
export const BIN_PARAMS = [
  'corners',
  'perRow',
  'softwareSlots',
  'cap',
  'instanceCap',
  'scratch',
] as const
if (BIN_PARAMS.length * 4 !== BIN_UNIFORM_BYTES) throw new Error('BIN_UNIFORM_BYTES')

/** The module's bindings: the parameters' struct, the buffers, the pass these pipelines bin. */
const BINS_BINDINGS_TEXT = `struct BinParams{${BIN_PARAMS.map((name) => `${name}:u32,`).join('')}}
@group(0) @binding(${B.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${B.visible}) var<storage,read> visible:array<u32>;
@group(0) @binding(${B.work}) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(${B.instances}) var<storage,read_write> instances:array<u32>;
@group(0) @binding(${B.indirect}) var<storage,read_write> indirect:array<atomic<u32>>;
@group(0) @binding(${B.slotOffsets}) var<storage,read_write> slotOffsets:array<u32>;
@group(0) @binding(${B.lists}) var<storage,read_write> lists:array<atomic<u32>>;
@group(0) @binding(${B.uniform}) var<uniform> params:BinParams;
/** The pass these pipelines bin: the main pass's or the post pass's (\`PASS\`, 0 or 1). */
override PASS:u32;
`

/** The module's constants, from the layer slots and the groups and scratch they make. */
const binsConstsText = (
  layerSlots: number,
  slots: number,
  g: ReturnType<typeof binGroups>,
  s: ReturnType<typeof binScratch>,
) =>
  wgslConsts({
    SLOTS: slots,
    SOFTWARE_OPAQUE: g.softwareOpaque,
    SOFTWARE_MASKED: g.softwareMasked,
    TESSELLATED: g.tessellated,
    GROUPS: g.total,
    COUNT: s.count,
    BASE: s.base,
    CURSOR: s.cursor,
    BUCKETS: s.buckets,
    LAYER_TOP: Math.max(0, layerSlots - 1),
    LAYER_UNITS: DEPTH_LAYER_BIAS_UNITS,
    KIND_OPAQUE: BIN_KIND.OPAQUE,
    KIND_CUTOUT: BIN_KIND.CUTOUT,
    KIND_VOXEL: BIN_KIND.VOXEL,
    KIND_SOFTWARE: BIN_KIND.SOFTWARE,
    CULL_BINS,
    HALF_SLOTS,
    BASE_SLOTS,
    BIN_BACK,
    BIN_NONE,
    BIN_FRONT,
    LIST_COUNT,
    LIST_AT,
    LIST_DISPATCH,
    LIST_TESS_COUNT,
    LIST_TESS_AT,
    LIST_TESS_DISPATCH,
    LIST_ROWS,
    PASS_POST: RASTER_PASS_POST,
  })

/** The reads of a cluster's page: its kind, its face, the group it goes in. */
const BINS_PLACE_TEXT = `const NONE:u32=0xffffffffu;
fn scratch(word:u32)->u32{return params.scratch+word;}
/** The ranges of the running pass (\`decodePlan\`). */
fn rangeWord(k:u32)->u32{return atomicLoad(&work[PASS*RANGE_WORDS+k]);}
/** The header word \`k\` of the pass numbered \`which\` in the lists. */
fn headerAt(which:u32,k:u32)->u32{return which*${headerWord(1)}u+k;}
/** The cluster of thread \`t\` among the pass's, software clusters first: its index in the list. */
fn clusterOf(t:u32,swCount:u32)->u32{
 return select(rangeWord(RANGE_HW_FIRST)+(t-swCount),rangeWord(RANGE_SW_FIRST)+t,t<swCount);
}
/** The kind of cluster \`page\` is, which orders its slots: voxel bricks, cutouts, others. */
fn kindOf(page:PageInfo)->u32{
 if((page.flags&${FLAG_VOXEL}u)!=0u){return KIND_VOXEL;}
 return select(KIND_OPAQUE,KIND_CUTOUT,(page.flags&${FLAG_MASK}u)!=0u);
}
/** The face mode of \`page\`: its surface's side, swapped by a mirrored placement, whose world
 *  reverses the winding. */
fn faceOf(page:PageInfo)->u32{
 if((page.flags&${FLAG_DOUBLE}u)!=0u){return BIN_NONE;}
 let mirrored=determinant(worldMatrix3(page.world))<0.0;
 return select(BIN_BACK,BIN_FRONT,((page.flags&${FLAG_BACK}u)!=0u)!=mirrored);
}
`

/** The slot of a page, the groups ordered by depth bucket, the place of a cluster. */
const BINS_SLOT_TEXT = `/** The slot of \`page\` of kind \`kind\` in the running pass's half: its kind and face mode, its
 *  coplanar layer — a voxel brick's is the first, its depth being its own —, the layer capped at
 *  the last. */
fn slotOf(page:PageInfo,kind:u32)->u32{
 let layer=select(min(page.depthBias/LAYER_UNITS,LAYER_TOP),0u,kind==KIND_VOXEL);
 return PASS*HALF_SLOTS+kind*CULL_BINS+faceOf(page)+BASE_SLOTS*layer;
}
/** The half slot \`slot\` belongs to: a layer's main bins, then its post ones. */
fn halfOf(slot:u32)->u32{return (slot%BASE_SLOTS)/HALF_SLOTS;}
/** The kind of cluster slot \`slot\` holds. */
fn kindOfSlot(slot:u32)->u32{return ((slot%BASE_SLOTS)%HALF_SLOTS)/CULL_BINS;}
/** Whether the clusters of group \`group\` are ordered by depth bucket: the cutout and voxel slots
 *  and the software cutouts. */
fn sortedGroup(group:u32)->bool{
 if(group>=SLOTS){return group==SOFTWARE_MASKED;}
 let kind=kindOfSlot(group);
 return kind==KIND_CUTOUT||kind==KIND_VOXEL;
}
/** Instances a cluster takes: its corners by batches of \`corners\`, at least one, at most the
 *  \`perRow\` the instance list holds a cluster. */
fn batchesOf(page:PageInfo)->u32{return clamp(ceilDiv(page.indexCount,params.corners),1u,params.perRow);}
/** Where a cluster goes: its group, the instances it takes there and its depth bucket. */
struct Place{group:u32,batches:u32,bucket:u32,}
/** The place of the cluster \`page\`, of tag \`tag\`, \`software\` its raster's: its own, or — \`extra\` —
 *  a software cluster's second, in the hardware slots the x-ray view walks (\`softwareSlots\`). A
 *  cluster the tessellation seeds from joins that list alone. Group \`NONE\` for none. */
fn placeOf(page:PageInfo,tag:u32,software:bool,extra:bool)->Place{
 var p=Place(NONE,0u,tag&${DEPTH_BUCKETS - 1}u);
 if((tag&VIS_TAG_TESSELLATED)!=0u){
  if(!extra){p.group=TESSELLATED;p.batches=1u;}
  return p;
 }
 if(page.indexCount==0u){return p;}
 let kind=kindOf(page);
 if(software&&!extra){
  p.group=select(SOFTWARE_OPAQUE,SOFTWARE_MASKED,kind==KIND_CUTOUT);p.batches=1u;
  return p;
 }
 if(extra){
  if(software&&params.softwareSlots!=0u){p.group=slotOf(page,KIND_SOFTWARE);p.batches=batchesOf(page);}
  return p;
 }
 p.group=slotOf(page,kind);p.batches=batchesOf(page);
 return p;
}
`

/** The count of the clusters of each group. */
const BINS_COUNT_TEXT = `/** The tally of the groups of one workgroup of the count, which it adds to the totals once. */
var<workgroup> tally:array<atomic<u32>,GROUPS>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn binCount(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let t=flatIndex(id,n,WORKGROUP_THREADS);
 let swCount=rangeWord(RANGE_SW_COUNT);
 if(t<swCount+rangeWord(RANGE_HW_COUNT)){
  let v=clusterOf(t,swCount);
  let r=VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*v;
  let tag=visible[r+2u];
  if((tag&VIS_TAG_BLENDED)==0u){
   let page=pages[v];
   for(var e=0u;e<2u;e++){
    let p=placeOf(page,tag,t<swCount,e==1u);
    if(p.group==NONE){continue;}
    atomicAdd(&tally[p.group],p.batches);
    if(sortedGroup(p.group)){atomicAdd(&work[scratch(BUCKETS+p.group*${DEPTH_BUCKETS}u+p.bucket)],p.batches);}
   }
  }
 }
 workgroupBarrier();
 for(var group=lane;group<GROUPS;group+=WORKGROUP_THREADS){
  let c=atomicLoad(&tally[group]);
  if(c!=0u){atomicAdd(&work[scratch(COUNT+group)],c);}
 }
}
`

/** The reservation of each group's place and the prefix sums of the depth buckets. */
const BINS_RESERVE_TEXT = `/** The write of slot \`slot\`'s draw command: its corners, its \`count\` instances. */
fn writeCommand(slot:u32,count:u32){
 let o=slot*4u;
 atomicStore(&indirect[o],params.corners);atomicStore(&indirect[o+1u],count);
 atomicStore(&indirect[o+2u],0u);atomicStore(&indirect[o+3u],0u);
}
var<workgroup> scanned:array<u32,${DEPTH_BUCKETS}>;
var<workgroup> baseOf:u32;
/** The place group \`group\` starts at, \`count\` its items: the hardware slots reserve their instances
 *  from the buffer's end so far — the main pass's end is where the post pass begins —, the
 *  software raster's and the tessellation's clusters follow the earlier pass's, the cutouts behind
 *  the others. */
fn reserve(group:u32,count:u32)->u32{
 if(group<SLOTS){
  if(count==0u){return 0u;}
  return atomicAdd(&work[INSTANCE_TOTAL],count);
 }
 if(group==TESSELLATED){
  return select(0u,atomicLoad(&lists[headerAt(0u,LIST_TESS_COUNT)]),PASS==PASS_POST);
 }
 let first=select(0u,atomicLoad(&lists[headerAt(0u,LIST_COUNT)]),PASS==PASS_POST);
 if(group==SOFTWARE_MASKED){return first+atomicLoad(&work[scratch(COUNT+SOFTWARE_OPAQUE)]);}
 return first;
}
@compute @workgroup_size(${DEPTH_BUCKETS})
fn binReserve(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let group=wg.x;
 let count=atomicLoad(&work[scratch(COUNT+group)]);
 if(lane==0u){baseOf=reserve(group,count);}
 let base=workgroupUniformLoad(&baseOf);
 // The depth buckets of an ordered group: each bucket's place, a prefix sum of the counts.
 var held=0u;
 let sorted=sortedGroup(group);
 if(sorted){held=atomicLoad(&work[scratch(BUCKETS+group*${DEPTH_BUCKETS}u+lane)]);}
 scanned[lane]=held;
 for(var reach=1u;reach<${DEPTH_BUCKETS}u;reach=reach*2u){
  workgroupBarrier();
  var before=0u;
  if(lane>=reach){before=scanned[lane-reach];}
  workgroupBarrier();
  scanned[lane]=scanned[lane]+before;
 }
 if(sorted){atomicStore(&work[scratch(BUCKETS+group*${DEPTH_BUCKETS}u+lane)],base+scanned[lane]-held);}
 if(lane!=0u){return;}
 atomicStore(&work[scratch(CURSOR+group)],base);
 atomicStore(&work[scratch(BASE+group)],base);
 if(group>=SLOTS){return;}
 slotOffsets[group]=base;
 // A slot of the running pass's half, its command; the main pass also empties the post half's, so
 // that a cut of one pass draws none of them.
 if(halfOf(group)==PASS){
  writeCommand(group,select(0u,min(count,params.instanceCap-min(base,params.instanceCap)),count!=0u));
 }else if(PASS==0u){
  writeCommand(group,0u);
 }
}
`

/** The scatter of the clusters into their groups and the lists' headers. */
const BINS_SCATTER_TEXT = `@compute @workgroup_size(WORKGROUP_THREADS)
fn binScatter(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let t=flatIndex(id,n,WORKGROUP_THREADS);
 let swCount=rangeWord(RANGE_SW_COUNT);
 if(t>=swCount+rangeWord(RANGE_HW_COUNT)){return;}
 let v=clusterOf(t,swCount);
 let tag=visible[VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*v+2u];
 if((tag&VIS_TAG_BLENDED)!=0u){return;}
 let page=pages[v];
 let stride=params.corners/3u;
 for(var e=0u;e<2u;e++){
  let p=placeOf(page,tag,t<swCount,e==1u);
  if(p.group==NONE){continue;}
  var at:u32;
  if(sortedGroup(p.group)){at=atomicAdd(&work[scratch(BUCKETS+p.group*${DEPTH_BUCKETS}u+p.bucket)],p.batches);}
  else{at=atomicAdd(&work[scratch(CURSOR+p.group)],p.batches);}
  if(p.group<SLOTS){
   for(var b=0u;b<p.batches;b++){
    if(at+b<params.instanceCap){instances[at+b]=v|((b*stride)<<${BATCH_SHIFT}u);}
   }
  }else if(at<params.cap){
   let first=select(LIST_ROWS,LIST_ROWS+params.cap,p.group==TESSELLATED);
   atomicStore(&lists[first+at],v);
  }
 }
}
/** The lists' headers: each list's count, where its entries begin and the dispatch of its raster. */
@compute @workgroup_size(1)
fn binFinalize(){
 let software=min(atomicLoad(&work[scratch(COUNT+SOFTWARE_OPAQUE)])+atomicLoad(&work[scratch(COUNT+SOFTWARE_MASKED)]),params.cap);
 let tessellated=min(atomicLoad(&work[scratch(COUNT+TESSELLATED)]),params.cap);
 let h=headerAt(PASS,0u);
 let swAt=atomicLoad(&work[scratch(BASE+SOFTWARE_OPAQUE)]);
 let tessAt=atomicLoad(&work[scratch(BASE+TESSELLATED)]);
 atomicStore(&lists[h+LIST_COUNT],software);
 atomicStore(&lists[h+LIST_AT],LIST_ROWS+swAt);
 let swGrid=groupGrid(software);
 atomicStore(&lists[h+LIST_DISPATCH],swGrid.x);atomicStore(&lists[h+LIST_DISPATCH+1u],swGrid.y);
 atomicStore(&lists[h+LIST_DISPATCH+2u],1u);
 atomicStore(&lists[h+LIST_TESS_COUNT],tessellated);
 atomicStore(&lists[h+LIST_TESS_AT],LIST_ROWS+params.cap+tessAt);
 let tessGrid=groupGrid(tessellated);
 atomicStore(&lists[h+LIST_TESS_DISPATCH],tessGrid.x);atomicStore(&lists[h+LIST_TESS_DISPATCH+1u],tessGrid.y);
 atomicStore(&lists[h+LIST_TESS_DISPATCH+2u],1u);
}
`

/** The module of the bins, for `layerSlots` coplanar layers. */
export const binsSource = (layerSlots: number) => {
  const slots = slotCount(layerSlots),
    g = binGroups(slots),
    s = binScratch(slots)
  return wgslProgram(
    `${BINS_BINDINGS_TEXT}${binsConstsText(layerSlots, slots, g, s)}
${BINS_PLACE_TEXT}${BINS_SLOT_TEXT}${BINS_COUNT_TEXT}${BINS_RESERVE_TEXT}${BINS_SCATTER_TEXT}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      VISIBLE_LAYOUT_WGSL,
      VIS_WORK_WGSL,
      worldMatrix3,
      ceilDivWgsl,
      FLAT_INDEX_WGSL,
      GROUP_GRID_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
}
