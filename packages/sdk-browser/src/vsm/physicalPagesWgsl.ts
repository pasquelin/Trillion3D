/**
 * Physical page management kernels.
 *
 * Each kernel is a complete WGSL module built for one `VsmLayout`: group 0 holds the VSM resources
 * (binding specs exported with the kernel, built by `vsmBindingsWgsl`), group 1 the loose shader
 * parameters (`VsmPmParams`, one dynamic-offset slot per dispatch variant), group 2 the per-page
 * dispatcher (`perPageDispatch.ts`) for the per-page kernels.
 *
 * Invariants of the kernels (WebGPU has no wave operations and at most 256 threads per group):
 * - The page list push, pop and page-to-process emit use one atomicAdd per thread. The set of
 *   entries pushed is the same whatever the thread order; only their order within a list varies.
 * - The available-pages compaction is one group of 256 looping over the list with a
 *   shared-memory exclusive prefix sum: an ordered compaction, so its output order is the input's.
 * - The indirect args of the 16-tiles-per-page kernels are (16, pages, 1), not (16·pages, 1, 1), so
 *   2·PoolPages·16 groups never exceed maxComputeWorkgroupsPerDimension (65535). The kernel
 *   rebuilds the 1D group index as wid.y·16 + wid.x: the same tiles, the same pixels.
 * - Stats only when the module is built with `stats: true` (the stats permutation): one more storage
 *   buffer, the eighth of the pool sort and of the page grant (its dispatcher's ids included).
 */
import {
  VSM_CONSTANTS_WGSL,
  VSM_COUNT_CLEARED,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_GRANTED,
  VSM_COUNT_WANTED,
  VSM_COUNT_STATIC_KEPT,
  VSM_PAGE_KEEP_FRAMES,
} from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from './projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import { vsmPerPageDispatchWgsl } from './perPageDispatch.ts'
import { VSM_PER_PAGE_DISPATCH_WGSL, VSM_PER_PAGE_GROUP_XY } from './markingWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/** Bind group indices of every page management kernel. */
export const VSM_PM_GROUP_RESOURCES = 0
export const VSM_PM_GROUP_PARAMS = 1
export const VSM_PM_GROUP_PER_PAGE = 2
/** Byte size of `VsmPmParams`; its slots lie the device's `uniformStride` apart. */
export const VSM_PM_PARAMS_BYTES = 8

/**
 * Loose parameters of the physical page kernels (update, address remap, ...): the next-map entries
 * this frame holds, and whether last frame's pages are kept (offsets 0 and 4).
 */
const VSM_PM_PARAMS_WGSL = wgslBlock(
  'VSM_PM_PARAMS_WGSL',
  [],
  `
struct VsmPmParams{
 nextMapCount:u32,
 hasPrevFrame:u32,
}
@group(${VSM_PM_GROUP_PARAMS}) @binding(0) var<uniform> vsmPm:VsmPmParams;
`,
)

interface VsmPmKernelOptions {
  /** Compile the statistics counters into the kernels (needs `res.stats` bound; one more storage buffer). */
  stats?: boolean
}

/** One compute kernel: its WGSL module, entry point and group-0 bindings. */
export interface VsmPmKernel {
  label: string
  entryPoint: string
  specs: VsmBindingSpec[]
  /** Uses group 2 (per-page dispatcher). */
  perPage: boolean
  code: string
}

/**
 * Assembles a module: the group-0 bindings of `specs`, params, optional per-page setup, optional
 * stats, then `body`, which lists the declarations its text uses.
 */
export function vsmPmModule(
  layout: VsmLayout,
  specs: VsmBindingSpec[],
  body: WgslDecl,
  options: { perPage?: boolean; stats?: boolean } = {},
) {
  const statsSpec = specs.find((s) => s.resource === 'stats')
  return wgslProgram(
    options.stats !== undefined
      ? statsSpec
        ? 'fn vsmCount(i:u32){atomicAdd(&vsmStats[i],1u);}'
        : 'fn vsmCount(i:u32){}'
      : '',
    [
      vsmBindingsWgsl(VSM_PM_GROUP_RESOURCES, specs, layout),
      VSM_PM_PARAMS_WGSL,
      ...(options.perPage ? [vsmPerPageDispatchWgsl(VSM_PM_GROUP_PER_PAGE)] : []),
      body,
    ],
  )
}

/** Appends the stats binding at `binding` when enabled. */
function withStats(
  specs: VsmBindingSpec[],
  stats: boolean | undefined,
  binding: number,
): VsmBindingSpec[] {
  return stats ? [...specs, { resource: 'stats', binding, access: 'atomic' }] : specs
}

const STAT_WGSL = wgslBlock(
  'STAT_WGSL',
  [],
  `
const VSM_COUNT_WANTED:u32=${VSM_COUNT_WANTED}u;
const VSM_COUNT_STATIC_KEPT:u32=${VSM_COUNT_STATIC_KEPT}u;
const VSM_COUNT_DYNAMIC_KEPT:u32=${VSM_COUNT_DYNAMIC_KEPT}u;
const VSM_COUNT_CLEARED:u32=${VSM_COUNT_CLEARED}u;
const VSM_COUNT_GRANTED:u32=${VSM_COUNT_GRANTED}u;
`,
)

/** List access over an atomic `vsmPoolLists` binding. */
const LISTS_WGSL = wgslBlock(
  'LISTS_WGSL',
  [],
  `
fn pmListStart(list:u32)->u32{return list*(vsm.poolPages+1u);}
fn pmListItem(list:u32,index:u32)->i32{return atomicLoad(&vsmPoolLists[pmListStart(list)+index]);}
fn pmSetListItem(list:u32,index:u32,value:i32){atomicStore(&vsmPoolLists[pmListStart(list)+index],value);}
fn pmListCount(list:u32)->i32{return atomicLoad(&vsmPoolLists[pmListStart(list)+vsm.poolPages]);}
fn pmSetListCount(list:u32,count:i32){atomicStore(&vsmPoolLists[pmListStart(list)+vsm.poolPages],count);}
/** Push onto a physical page list: guarded against overflowing into the counter / next list. */
fn pmPush(list:u32,poolIndex:i32)->bool{
 let start=pmListStart(list);
 let offset=atomicAdd(&vsmPoolLists[start+vsm.poolPages],1i);
 if(offset<i32(vsm.poolPages)){
  atomicStore(&vsmPoolLists[start+u32(offset)],poolIndex);
  return true;
 }
 return false;
}
/** Single-group kernels' lanes, looping over a list. */
const PM_PACK_THREADS:u32=256u;
/**
 * Appends list \`inputList\` to \`outputList\`, which holds \`outputCount\` items, by the
 * \`PM_PACK_THREADS\` lanes of one group: order kept, robust to pool overflow, then the output's count
 * raised and the input's cleared — once every lane read the input's count. Reached in uniform flow.
 */
fn pmAppendList(inputList:u32,outputList:u32,outputCount:i32,lane:u32){
 let inputCount=pmListCount(inputList);
 let copyCount=max(0i,min(inputCount,i32(vsm.poolPages)-outputCount));
 // A uniform loop, so that the barrier after it is reached in uniform flow.
 for(var first=0u;first<vsm.poolPages;first+=PM_PACK_THREADS){
  let t=i32(first+lane);
  if(t<copyCount){pmSetListItem(outputList,u32(outputCount+t),pmListItem(inputList,u32(t)));}
 }
 storageBarrier();
 if(lane==0u){
  pmSetListCount(outputList,outputCount+copyCount);
  pmSetListCount(inputList,0i);
 }
}
/** Pop from a physical page list: < 0 if none available. The counter may go negative; the empty check reads it as an empty list. */
fn pmPop(list:u32)->i32{
 let start=pmListStart(list);
 let offset=atomicAdd(&vsmPoolLists[start+vsm.poolPages],-1i)-1i;
 if(offset<0i){return -1i;}
 return atomicLoad(&vsmPoolLists[start+u32(offset)]);
}
`,
)

/** Moves last frame's pool pages to this frame's map ids and page addresses, before the marking pass;
 *  without a previous frame (`vsmPm.hasPrevFrame`) every page is emptied. */
function carryPages(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
    { resource: 'nextMaps', binding: 2 },
    { resource: 'pageRequests', binding: 3, prev: true },
  ]
  const body = wgslBlock(
    'carryPages',
    [VSM_CONSTANTS_WGSL, VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL],
    `
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmCarryPages(@builtin(global_invocation_id) index:vec3u){
 if(index.x>=vsm.poolPages){return;}
 let poolIndex=index.x;
 if(vsmPm.hasPrevFrame==0u){
  vsmPoolPageInfo[poolIndex].flags=0u;
  return;
 }
 let prevInfo=vsmPoolPageInfo[poolIndex];
 var prevEntry=vsmTableCellUnpack(0u);
 var keepsPage=false;
 if(prevInfo.flags!=0u){
  // Only a map id the next-map table holds this frame is followed.
  let prevHandle=vsmHandleFromId(prevInfo.mapId);
  if(vsmHandleIsValid(prevHandle)&&prevHandle.id<vsmPm.nextMapCount){
   prevEntry=vsmTableEntryOf(prevHandle,prevInfo.mipLevel,prevInfo.pageAddress);
   let nextMaps=vsmNextMaps[prevHandle.id];
   if((nextMaps.flags&VSM_NEXT_KEEPS_PAGES)!=0u){
    let handle=vsmHandleFromId(u32(nextMaps.nextMapId));
    // A clipmap level's pages shift as its centre snaps; any other map's stay.
    let movedPage=vec2i(prevInfo.pageAddress)+nextMaps.pageShift;
    if(vsmPageInRange(movedPage,prevInfo.mipLevel)){
     vsmPoolPageInfo[poolIndex].mapId=handle.id;
     vsmPoolPageInfo[poolIndex].pageAddress=vec2u(movedPage);
     keepsPage=true;
    }
   }
  }
 }
 if(keepsPage){
  // The stale bits the invalidation set on last frame's requests join the page's words.
  let prevRequest=vsmPrevPageRequestsLoad(vsmTableIndex(prevEntry.tableXY));
  let staleBits=prevRequest&VSM_META_ANY_STALE;
  if(staleBits!=0u){
   vsmPoolPageInfo[poolIndex].flags=prevInfo.flags|staleBits;
  }
 }else{
  vsmPoolPageInfo[poolIndex].flags=0u;
 }
}
`,
  )
  return {
    label: 'CarryPages',
    entryPoint: 'vsmCarryPages',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/** Sorts the pool: each page in last frame's age order is kept, aged out or emptied, and the
 *  lists are filled. */
function sortPool(layout: VsmLayout, o: VsmPmKernelOptions): VsmPmKernel {
  const specs = withStats(
    [
      { resource: 'uniforms', binding: 0 },
      { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
      { resource: 'poolLists', binding: 2, access: 'atomic' },
      { resource: 'poolLists', binding: 3, prev: true },
      { resource: 'pageRequests', binding: 4 },
      { resource: 'pageTable', binding: 5, access: 'read_write' },
      { resource: 'pageMarks', binding: 6, access: 'read_write' },
      { resource: 'projectionData', binding: 7 },
    ],
    o.stats,
    8,
  )
  const body = wgslBlock(
    'sortPool',
    [
      STAT_WGSL,
      LISTS_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
    ],
    `
/** Frames a page unrequested since stays kept (\`VSM_PAGE_KEEP_FRAMES\`). */
const PM_PAGE_KEEP_FRAMES:i32=${VSM_PAGE_KEEP_FRAMES}i;
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmSortPool(@builtin(global_invocation_id) index:vec3u){
 if(index.x>=vsm.poolPages){return;}
 // The page's rank in the age order.
 let byAgeIndex=index.x;
 var leftList=false;
 var poolIndex=byAgeIndex;
 var nextMeta=0u;
 if(vsmPm.hasPrevFrame!=0u){
  // Last frame's requested list, the free pages after it (\`vsmPoolFeedback\`): the age order.
  poolIndex=u32(vsmPrevPoolLists[pmListStart(VSM_PAGES_REQUESTED)+byAgeIndex]);
  let prevInfo=vsmPoolPageInfo[poolIndex];
  let mipLevel=prevInfo.mipLevel;
  if(prevInfo.flags!=0u){
   let handle=vsmHandleFromId(prevInfo.mapId);
   let pageAddress=prevInfo.pageAddress;
   // Whether this frame's marking asked for the page again.
   let entryAt=vsmTableEntryOf(handle,mipLevel,pageAddress);
   let entryIndex=vsmTableIndex(entryAt.tableXY);
   let flagsIndex=vsmPageMarkIndex(entryAt.tableXY,0u);
   let requestWord=vsmPageRequestsLoad(entryIndex);
   let wantedNow=requestWord!=0u;
   let wantedAge=i32(vsm.frameStamp-prevInfo.lastWantedStamp);
   // A page of an unseen light stays whatever its age, until another map takes it.
   let projection=vsmProjectionOf(handle);
   if(wantedNow||projection.lightUnseen||wantedAge<=PM_PAGE_KEEP_FRAMES){
    // The page keeps its map id and address: the slot already holds them.
    let prevMeta=prevInfo.flags;
    if(!wantedNow||projection.lightUnseen){
     // Not drawn this frame: the page keeps its words, stale bits included, marked unseen.
     nextMeta=prevMeta|VSM_META_UNSEEN;
     // Wanted alone: the invalidation finds it, the raster does not draw it.
     vsmPageMarksStore(flagsIndex,VSM_PAGE_WANTED);
    }else{
     var nextMarks=VSM_PAGE_WANTED;
     let requestFine=requestWord&VSM_PAGE_FINE;
     let staticStale=(prevMeta&VSM_META_STATIC_STALE)!=0u;
     let keepDynamic=handle.isSinglePage
      ||(requestFine==0u&&projection.coarseDynamicCached&&!staticStale);
     // A single-page map, or a coarse page of a map whose coarse pages keep their dynamic layer,
     // is not redrawn for a stale bit.
     if(!keepDynamic){
      if((prevMeta&VSM_META_ANY_STALE)!=0u){
       if((prevMeta&VSM_META_STATIC_STALE)==0u){
        nextMarks|=VSM_PAGE_DYNAMIC_STALE;
       }else{
        nextMarks|=VSM_PAGE_ANY_STALE;
       }
      }
      // A page drawn for the covered receivers alone may miss a caster: its dynamic layer is
      // drawn again each frame.
      if(projection.useCover){
       nextMarks|=VSM_PAGE_DYNAMIC_STALE;
      }
     }
     // Requested: the page leaves the age order for the requested list.
     vsmCount(VSM_COUNT_WANTED);
     pmPush(VSM_PAGES_REQUESTED,i32(poolIndex));
     vsmPoolPageInfo[poolIndex].lastWantedStamp=vsm.frameStamp;
     leftList=true;
     // A page asked fine where it was held coarse, or the reverse, is drawn again whole.
     if(requestFine!=(prevMeta&VSM_PAGE_FINE)){
      nextMarks|=VSM_PAGE_STATIC_STALE|VSM_PAGE_DYNAMIC_STALE;
     }
     if((nextMarks&VSM_PAGE_STATIC_STALE)==0u){vsmCount(VSM_COUNT_STATIC_KEPT);}
     if((nextMarks&VSM_PAGE_DYNAMIC_STALE)==0u){vsmCount(VSM_COUNT_DYNAMIC_KEPT);}
     nextMarks|=requestFine;
     let viewBits=select(0u,VSM_META_VIEW_UNCACHED,projection.uncached);
     nextMeta=nextMarks|viewBits;
     // The cleared bits carry over.
     nextMeta|=prevMeta&VSM_META_ANY_CLEARED;
     let drawsNow=(nextMarks&VSM_PAGE_ANY_STALE)!=0u;
     // The page's entry (cleared again where a new map takes the page).
     vsmPageTableStore(entryIndex,vsmPackTableEntry(vsmPoolPageOf(poolIndex),drawsNow));
     vsmPageMarksStore(flagsIndex,nextMarks);
    }
   }
  }
 }
 // A page left with no word goes to the empty list, appended after the free ones once packed.
 if(nextMeta==0u){
  pmPush(VSM_PAGES_EMPTY,i32(poolIndex));
  leftList=true;
 }
 vsmPoolPageInfo[poolIndex].flags=nextMeta;
 // The age order keeps its ranks; a page that left it reads -1.
 pmSetListItem(VSM_PAGES_BY_AGE,byAgeIndex,select(i32(poolIndex),-1i,leftList));
}
`,
  )
  return {
    label: 'SortPool',
    entryPoint: 'vsmSortPool',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body, { stats: !!o.stats }),
  }
}

/** Compacts the available pages, then appends the empty ones after them: allocated before the pages
 *  holding cached data (single group, uniform loop). */
function packFreePages(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolLists', binding: 1, access: 'atomic' },
  ]
  const body = wgslBlock(
    'packFreePages',
    [LISTS_WGSL, VSM_CONSTANTS_WGSL],
    `
var<workgroup> pmScan:array<i32,PM_PACK_THREADS>;
@compute @workgroup_size(PM_PACK_THREADS)
fn vsmPackFreePages(@builtin(local_invocation_index) groupIndex:u32){
 var totalCount=0i;
 let maxPages=i32(vsm.poolPages);
 // Uniform loop: every thread runs every iteration (barriers inside).
 for(var groupStart=0i;groupStart<maxPages;groupStart+=i32(PM_PACK_THREADS)){
  let listIndex=groupStart+i32(groupIndex);
  var poolIndex=-1i;
  if(listIndex<maxPages){poolIndex=pmListItem(VSM_PAGES_BY_AGE,u32(listIndex));}
  let listItemValid=poolIndex!=-1i;
  let sumValue=select(0i,1i,listItemValid);
  // Group prefix sum: inclusive Hillis-Steele scan, exclusive offset, group total.
  pmScan[groupIndex]=sumValue;
  workgroupBarrier();
  for(var stride=1u;stride<PM_PACK_THREADS;stride<<=1u){
   var v=0i;
   if(groupIndex>=stride){v=pmScan[groupIndex-stride];}
   workgroupBarrier();
   pmScan[groupIndex]+=v;
   workgroupBarrier();
  }
  let offset=pmScan[groupIndex]-sumValue;
  let groupCount=workgroupUniformLoad(&pmScan[PM_PACK_THREADS-1u]);
  if(listItemValid){
   pmSetListItem(VSM_PAGES_FREE,u32(totalCount+offset),poolIndex);
  }
  totalCount+=groupCount;
  workgroupBarrier();
 }
 // The compacted list's count is every lane's \`totalCount\`: the empty pages go after it.
 pmAppendList(VSM_PAGES_EMPTY,VSM_PAGES_FREE,totalCount,groupIndex);
}
`,
  )
  return {
    label: 'PackFreePages',
    entryPoint: 'vsmPackFreePages',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/** Maps the newly requested pages onto available physical pages, driven by the per-page dispatcher. */
function grantPages(layout: VsmLayout, o: VsmPmKernelOptions): VsmPmKernel {
  const specs = withStats(
    [
      { resource: 'uniforms', binding: 0 },
      { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
      { resource: 'poolLists', binding: 2, access: 'atomic' },
      { resource: 'pageRequests', binding: 3 },
      { resource: 'pageTable', binding: 4, access: 'read_write' },
      { resource: 'pageMarks', binding: 5, access: 'read_write' },
      { resource: 'projectionData', binding: 6 },
    ],
    o.stats,
    7,
  )
  const body = wgslBlock(
    'grantPages',
    [
      STAT_WGSL,
      LISTS_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_PER_PAGE_DISPATCH_WGSL,
    ],
    `
fn pmGrantPage(handle:VsmHandle,entryAt:VsmTableCell,mipLevel:u32,pageAddress:vec2u){
 let entryIndex=vsmTableIndex(entryAt.tableXY);
 let flagsIndex=vsmPageMarkIndex(entryAt.tableXY,0u);
 let requestWord=vsmPageRequestsLoad(entryIndex);
 if(requestWord==0u){return;}
 // A page already mapped needs no other.
 let pageMarks=vsmPageMarksLoad(flagsIndex)&VSM_PAGE_MARK_MASK;
 if(pageMarks!=0u){return;}
 vsmCount(VSM_COUNT_WANTED);
 let poolIndex=pmPop(VSM_PAGES_FREE);
 if(poolIndex<0i){
  // No free page: the request stays unmapped.
  return;
 }
 vsmCount(VSM_COUNT_GRANTED);
 pmPush(VSM_PAGES_REQUESTED,poolIndex);
 let poolSlot=u32(poolIndex);
 let poolPageXY=vsmPoolPageOf(poolSlot);
 // The map that held this pool page loses its entry first.
 let prevInfo=vsmPoolPageInfo[poolSlot];
 if((prevInfo.flags&VSM_PAGE_WANTED)!=0u){
  let prevOffset=vsmTableEntryOf(vsmHandleFromId(prevInfo.mapId),prevInfo.mipLevel,prevInfo.pageAddress);
  vsmPageTableStore(vsmTableIndex(prevOffset.tableXY),0u);
  vsmPageMarksStore(vsmPageMarkIndex(prevOffset.tableXY,0u),0u);
 }
 let requestFine=requestWord&VSM_PAGE_FINE;
 let flags=VSM_PAGE_WANTED|VSM_PAGE_DYNAMIC_STALE|VSM_PAGE_STATIC_STALE|requestFine;
 // A new page is drawn whole.
 vsmPageTableStore(entryIndex,vsmPackTableEntry(poolPageXY,true));
 vsmPageMarksStore(flagsIndex,flags);
 let projection=vsmProjectionOf(handle);
 let viewBits=select(0u,VSM_META_VIEW_UNCACHED,projection.uncached);
 // A reused page keeps none of its cleared bits.
 vsmPoolPageInfo[poolSlot].flags=flags|viewBits;
 vsmPoolPageInfo[poolSlot].lastWantedStamp=vsm.frameStamp;
 vsmPoolPageInfo[poolSlot].mapId=handle.id;
 vsmPoolPageInfo[poolSlot].mipLevel=mipLevel;
 vsmPoolPageInfo[poolSlot].pageAddress=pageAddress;
}
@compute @workgroup_size(${VSM_PER_PAGE_GROUP_XY},${VSM_PER_PAGE_GROUP_XY})
fn vsmGrantPages(@builtin(global_invocation_id) dispatchThreadId:vec3u,@builtin(num_workgroups) numWorkgroups:vec3u){
 let setup=vsmMapWalkOf(dispatchThreadId,numWorkgroups);
 if(!setup.valid){return;}
 for(var mipLevel=setup.firstMip;mipLevel<setup.endMip;mipLevel++){
  let loopEnd=vsmPagesAcross(mipLevel);
  for(var pageY=setup.walkStart.y;pageY<loopEnd;pageY+=setup.walkStep){
   for(var pageX=setup.walkStart.x;pageX<loopEnd;pageX+=setup.walkStep){
    let entryCell=vsmTableEntryOf(setup.handle,mipLevel,vec2u(pageX,pageY));
    pmGrantPage(setup.handle,entryCell,mipLevel,vec2u(pageX,pageY));
   }
  }
 }
}
`,
  )
  return {
    label: 'GrantPages',
    entryPoint: 'vsmGrantPages',
    specs,
    perPage: true,
    code: vsmPmModule(layout, specs, body, { perPage: true, stats: !!o.stats }),
  }
}

/** Lists the pages to clear. Args (16, pages, 1): see header. */
function listClears(layout: VsmLayout, o: VsmPmKernelOptions): VsmPmKernel {
  const specs = withStats(
    [
      { resource: 'uniforms', binding: 0 },
      { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
      { resource: 'clearArgs', binding: 2, access: 'atomic' },
      { resource: 'pagesToClear', binding: 3, access: 'read_write' },
    ],
    o.stats,
    4,
  )
  const body = wgslBlock(
    'listClears',
    [STAT_WGSL, VSM_CONSTANTS_WGSL],
    `
/** Emits one page slot per call (16 tile groups each). */
fn pmListClear(poolIndex:u32){
 let slot=atomicAdd(&vsmClearArgs[1],1u);
 vsmPagesToClearStore(slot,poolIndex);
}
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmListClears(@builtin(global_invocation_id) id:vec3u){
 let poolIndex=id.x;
 if(poolIndex>=vsm.poolPages){return;}
 let pageInfo=vsmPoolPageInfo[poolIndex];
 let unreferenced=(pageInfo.flags&VSM_META_UNSEEN)!=0u;
 let fullyCached=(pageInfo.flags&VSM_PAGE_ANY_STALE)==0u;
 if((pageInfo.flags&VSM_PAGE_WANTED)==0u){
  // No map holds the page.
 }else if(unreferenced||fullyCached){
  // Kept whole, or its light unseen: the page is left as it is.
 }else{
  var clearedFlags=0u;
  // Its static layer, unless cleared already.
  if((pageInfo.flags&VSM_PAGE_STATIC_STALE)!=0u&&(pageInfo.flags&VSM_META_VIEW_UNCACHED)==0u){
   if((pageInfo.flags&VSM_META_STATIC_CLEARED)==0u){
    pmListClear(poolIndex+vsm.poolPages);
    vsmCount(VSM_COUNT_CLEARED);
    clearedFlags|=VSM_META_STATIC_CLEARED|VSM_META_STATIC_DRAWN;
   }
  }
  // Its dynamic layer, unless cleared already; always when the static one was (its copy is stale).
  if((pageInfo.flags&VSM_META_DYNAMIC_CLEARED)==0u||clearedFlags!=0u){
   pmListClear(poolIndex);
   vsmCount(VSM_COUNT_CLEARED);
   // Drawn too: its tile depths are rebuilt and its static layer merged.
   clearedFlags|=VSM_META_DYNAMIC_CLEARED|VSM_META_DYNAMIC_DRAWN;
  }
  vsmPoolPageInfo[poolIndex].flags=pageInfo.flags|clearedFlags;
 }
}
`,
  )
  return {
    label: 'ListClears',
    entryPoint: 'vsmListClears',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body, { stats: !!o.stats }),
  }
}

/** Tile setup of the 16-tiles-per-page kernels (16x16 threads, 32x32 texels per tile). */
const TILE_WGSL = wgslBlock(
  'TILE_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_PAGE_ADDRESS_WGSL],
  `
const PM_TILE_LANES:u32=16u;
const PM_LOG2_TILE:u32=5u;
const PM_LOG2_TILES_ACROSS:u32=VSM_LOG2_PAGE-PM_LOG2_TILE;
const PM_LOG2_TILES:u32=2u*PM_LOG2_TILES_ACROSS;
const PM_TILES:u32=1u<<PM_LOG2_TILES;
const PM_TILES_ACROSS_MASK:u32=(1u<<PM_LOG2_TILES_ACROSS)-1u;
const PM_TILES_MASK:u32=(1u<<PM_LOG2_TILES)-1u;
/** The 1D group index of a (16, pages, 1) dispatch. */
fn pmGroupIndex(wid:vec3u)->u32{return wid.y*PM_TILES+wid.x;}
struct PmTile{poolPageIndex:u32,poolSlice:u32,poolPage:vec2u,tileOrigin:vec2u,}
/** The tile setup of a listed page: entries >= poolPages address the static slice. */
fn pmTileOf(groupIndex:u32,listedPage:u32)->PmTile{
 var r:PmTile;
 let tileIndex=groupIndex&PM_TILES_MASK;
 r.tileOrigin=vec2u(tileIndex&PM_TILES_ACROSS_MASK,tileIndex>>PM_LOG2_TILES_ACROSS)<<vec2u(PM_LOG2_TILE);
 r.poolPageIndex=listedPage;
 r.poolSlice=0u;
 if(r.poolPageIndex>=vsm.poolPages){
  r.poolPageIndex-=vsm.poolPages;
  r.poolSlice=1u;
 }
 r.poolPage=vsmPoolPageOf(r.poolPageIndex);
 return r;
}
fn pmTileOffset(s:PmTile)->vec2u{return (s.poolPage<<vec2u(VSM_LOG2_PAGE))+s.tileOrigin;}
`,
)

/** Clears or initialises the listed pages, one tile per group. */
function clearPages(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolPageInfo', binding: 1 },
    { resource: 'pagesToClear', binding: 2 },
    { resource: 'pagePool', binding: 3, access: 'read_write' },
  ]
  const body = wgslBlock(
    'clearPages',
    [TILE_WGSL, VSM_CONSTANTS_WGSL],
    `
@compute @workgroup_size(16,16)
fn vsmClearPages(@builtin(local_invocation_id) tileThreadId:vec3u,@builtin(workgroup_id) wid:vec3u){
 let groupIndex=pmGroupIndex(wid);
 let setup=pmTileOf(groupIndex,vsmPagesToClearLoad(groupIndex>>PM_LOG2_TILES));
 let pageInfo=vsmPoolPageInfo[setup.poolPageIndex];
 let firstTexel=pmTileOffset(setup)+tileThreadId.xy;
 let slice=setup.poolSlice;
 let staticCached=(pageInfo.flags&VSM_PAGE_STATIC_STALE)==0u;
 let stride=PM_TILE_LANES;
 var o=array<vec2u,4>(vec2u(0u,0u),vec2u(stride,0u),vec2u(0u,stride),vec2u(stride,stride));
 if(staticCached&&(pageInfo.flags&VSM_META_VIEW_UNCACHED)==0u){
  // Initialize from the static page (slice + 1: the static slice follows the dynamic one).
  for(var k=0u;k<4u;k++){vsmPoolStore(firstTexel+o[k],slice,vsmPoolLoad(firstTexel+o[k],slice+1u));}
 }else{
  for(var k=0u;k<4u;k++){vsmPoolStore(firstTexel+o[k],slice,0u);}
 }
}
`,
  )
  return {
    label: 'ClearPages',
    entryPoint: 'vsmClearPages',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/** The status feedback → `res.feedback` = [VSM_FEEDBACK_POOL, free pages (i32), pressure bias (f32 bits), scene frame]. */
function poolFeedback(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolLists', binding: 1, access: 'atomic' },
    { resource: 'feedback', binding: 2, access: 'read_write' },
  ]
  const body = wgslBlock(
    'poolFeedback',
    [LISTS_WGSL, VSM_CONSTANTS_WGSL],
    `
@compute @workgroup_size(PM_PACK_THREADS)
fn vsmPoolFeedback(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  vsmFeedbackStore(0u,0u);
  // Pages still available.
  vsmFeedbackStore(1u,bitcast<u32>(pmListCount(VSM_PAGES_FREE)));
  // This frame's pressure bias.
  vsmFeedbackStore(2u,bitcast<u32>(vsm.pressureBias));
  // Frame tag of the message.
  vsmFeedbackStore(3u,vsm.frameStamp);
 }
 // Then the pages still available go after the requested ones for next frame: every lane reads
 // the counts before the append clears the available one (\`pmAppendList\`'s barrier).
 let requested=pmListCount(VSM_PAGES_REQUESTED);
 pmAppendList(VSM_PAGES_FREE,VSM_PAGES_REQUESTED,requested,lane);
}
`,
  )
  return {
    label: 'PoolFeedback',
    entryPoint: 'vsmPoolFeedback',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/**
 * After the render, a thread a page: folds the dirty flags into the page metadata, then lists the
 * page by those flags (16 groups a listed page each list):
 * - its slice 0 changed this frame — dirty, static or dynamic, referenced, a sun's —: for its tile
 *   depths (`pagesForTiles`, `tileArgs`, `vsmTileDepthsBuild`). The tile depths
 *   are slice 0's, so a dynamic change makes them stale too, not only a static one;
 * - its static slice was written — allocated, referenced, cached for the view —: to merge static
 *   into dynamic (`pagesToMerge`, `mergeArgs`, `vsmMergeStatic`).
 * An unreferenced page is not drawn this frame: its dirty flags are an older frame's. Each list
 * reads the page's own flags as folded: the lists the two kernels made one after the other.
 */
function foldRasterMarks(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'rasterMarks', binding: 1 },
    { resource: 'poolPageInfo', binding: 2, access: 'read_write' },
    { resource: 'tileArgs', binding: 3, access: 'atomic' },
    { resource: 'pagesForTiles', binding: 4, access: 'read_write' },
    { resource: 'projectionData', binding: 5 },
    { resource: 'mergeArgs', binding: 6, access: 'atomic' },
    { resource: 'pagesToMerge', binding: 7, access: 'read_write' },
  ]
  const body = wgslBlock(
    'foldRasterMarks',
    [VSM_CONSTANTS_WGSL],
    `
// Folds this frame's dirty flags into the page's metadata; the frame clears them before its raster
// (\`vsmEncode.ts\`).
fn pmFoldMarks(poolIndex:u32)->u32{
 let n=vsm.poolPages;
 let dynamicDrawn=vsmRasterMarksLoad(poolIndex+0u*n)!=0u;
 let staticDrawn=vsmRasterMarksLoad(poolIndex+1u*n)!=0u;
 let invalidatesDynamic=vsmRasterMarksLoad(poolIndex+2u*n)!=0u;
 let invalidatesStatic=vsmRasterMarksLoad(poolIndex+3u*n)!=0u;
 var flags=vsmPoolPageInfo[poolIndex].flags;
 if(flags!=0u){
  // Drawn this frame: cleared no longer.
  if(dynamicDrawn){
   flags&=~VSM_META_DYNAMIC_CLEARED;
   flags|=VSM_META_DYNAMIC_DRAWN;
  }
  if(staticDrawn){
   flags&=~VSM_META_STATIC_CLEARED;
   flags|=VSM_META_STATIC_DRAWN;
  }
  flags|=select(0u,VSM_META_DYNAMIC_STALE,invalidatesDynamic)
   |select(0u,VSM_META_STATIC_STALE,invalidatesStatic);
  vsmPoolPageInfo[poolIndex].flags=flags;
 }
 return flags;
}
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmFoldRasterMarks(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=vsm.poolPages){return;}
 let flags=pmFoldMarks(id.x);
 if((flags&VSM_PAGE_WANTED)!=0u&&(flags&VSM_META_ANY_DRAWN)!=0u&&(flags&VSM_META_UNSEEN)==0u
  // A sun's page only: the clipmap rays alone read tile depths. A page handed to a sun later is
  // initialised there, dirty then.
  &&vsmProjectionData[vsmPoolPageInfo[id.x].mapId].lightKind==LIGHT_KIND_DIRECTIONAL){
  let slot=atomicAdd(&vsmTileArgs[1],1u);
  vsmPagesForTilesStore(slot,id.x);
 }
 // Merging only if the static page was written.
 if((flags&VSM_PAGE_WANTED)!=0u
  &&(flags&VSM_META_UNSEEN)==0u
  &&(flags&VSM_META_VIEW_UNCACHED)==0u
  &&(flags&VSM_META_STATIC_DRAWN)!=0u){
  let slot=atomicAdd(&vsmMergeArgs[1],1u);
  vsmPagesToMergeStore(slot,id.x);
 }
}
`,
  )
  return {
    label: 'FoldRasterMarks',
    entryPoint: 'vsmFoldRasterMarks',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/**
 * The tile depths of the listed pages, after the merge (a
 * group per 32×32 tile, each thread 2×2 texels): each 8×8 tile's greatest slice-0 word whose
 * float is not below 0 or NaN — the closest depth a sample in it can read
 * (`vsmSunRayMisses`). Workgroup memory starts at zero (WebGPU).
 */
function tileDepthsBuild(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'pagesForTiles', binding: 1 },
    { resource: 'tileDepths', binding: 2, access: 'read_write' },
    { resource: 'pagePool', binding: 3 },
  ]
  const body = wgslBlock(
    'tileDepthsBuild',
    [TILE_WGSL, VSM_CONSTANTS_WGSL, VSM_PAGE_ADDRESS_WGSL],
    `
var<workgroup> pmTileDepth:array<atomic<u32>,16>;
/** A pool word as a bound of the depth a sample reads from it: the word, but 0 for one whose float
 *  is negative or NaN (above +inf's bits), which no sample's test can be failed by. */
fn pmTileDepthWord(w:u32)->u32{return select(w,0u,w>0x7F800000u);}
fn pmTileDepthOf2x2(p:vec2u)->u32{
 return max(max(pmTileDepthWord(vsmPoolLoad(p,0u)),pmTileDepthWord(vsmPoolLoad(p+vec2u(1u,0u),0u))),
  max(pmTileDepthWord(vsmPoolLoad(p+vec2u(0u,1u),0u)),pmTileDepthWord(vsmPoolLoad(p+vec2u(1u,1u),0u))));
}
@compute @workgroup_size(16,16)
fn vsmTileDepthsBuild(@builtin(local_invocation_id) tileThreadId:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3u){
 let groupIndex=pmGroupIndex(wid);
 let setup=pmTileOf(groupIndex,vsmPagesForTilesLoad(groupIndex>>PM_LOG2_TILES));
 // 2x2 texels per thread, a 32x32 tile per group: its 4x4 tiles of 8x8, each slot starting at 0.
 let origin=pmTileOffset(setup);
 let word=pmTileDepthOf2x2(origin+(tileThreadId.xy<<vec2u(1u)));
 if(word!=0u){atomicMax(&pmTileDepth[(tileThreadId.y>>2u)*4u+(tileThreadId.x>>2u)],word);}
 workgroupBarrier();
 if(lane<16u){
  let texel=origin+(vec2u(lane&3u,lane>>2u)<<vec2u(VSM_LOG2_TILE_DEPTH_TEXELS));
  vsmTileDepthsStore(vsmTileDepthIndex(texel),atomicLoad(&pmTileDepth[lane]));
 }
}
`,
  )
  return {
    label: 'TileDepthsBuild',
    entryPoint: 'vsmTileDepthsBuild',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/** Merges the static pages into the dynamic ones: dynamic = max(dynamic, static). */
function mergeStatic(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'pagesToMerge', binding: 1 },
    { resource: 'pagePool', binding: 2, access: 'read_write' },
  ]
  const body = wgslBlock(
    'mergeStatic',
    [TILE_WGSL],
    `
fn pmMergeTexel(p:vec2u){
 vsmPoolStore(p,0u,max(vsmPoolLoad(p,0u),vsmPoolLoad(p,vsm.staticSlice)));
}
@compute @workgroup_size(16,16)
fn vsmMergeStatic(@builtin(local_invocation_id) tileThreadId:vec3u,@builtin(workgroup_id) wid:vec3u){
 let groupIndex=pmGroupIndex(wid);
 let setup=pmTileOf(groupIndex,vsmPagesToMergeLoad(groupIndex>>PM_LOG2_TILES));
 // 2x2 texels per thread.
 let firstTexel=pmTileOffset(setup)+(tileThreadId.xy<<vec2u(1u));
 pmMergeTexel(firstTexel+vec2u(0u,0u));
 pmMergeTexel(firstTexel+vec2u(1u,0u));
 pmMergeTexel(firstTexel+vec2u(0u,1u));
 pmMergeTexel(firstTexel+vec2u(1u,1u));
}
`,
  )
  return {
    label: 'MergeStatic',
    entryPoint: 'vsmMergeStatic',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body),
  }
}

/** Every page management kernel for `layout`. */
export function vsmPhysicalPageKernels(layout: VsmLayout, options: VsmPmKernelOptions = {}) {
  return {
    carryPages: carryPages(layout),
    sortPool: sortPool(layout, options),
    packFreePages: packFreePages(layout),
    grantPages: grantPages(layout, options),
    listClears: listClears(layout, options),
    clearPages: clearPages(layout),
    poolFeedback: poolFeedback(layout),
    foldRasterMarks: foldRasterMarks(layout),
    mergeStatic: mergeStatic(layout),
    tileDepthsBuild: tileDepthsBuild(layout),
  }
}
