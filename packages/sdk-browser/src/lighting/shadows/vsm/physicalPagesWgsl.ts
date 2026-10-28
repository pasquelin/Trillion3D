import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
/**
 * Physical page management kernels.
 *
 * Each kernel is a complete WGSL module built for one `VsmLayout`: group 0 holds the VSM resources
 * (binding specs exported with the kernel, built by `vsmBindingsWgsl`), group 1 the loose shader
 * parameters (`VsmPmParams`, one dynamic-offset slot per dispatch variant), group 2 the per-page
 * dispatcher (`perPageDispatch.ts`) for the per-page kernels.
 *
 * Invariants of the kernels (WebGPU has no wave operations and at most 256 threads per group):
 * - The free pages are the available list of the pool's page lists (`freePagesWgsl.ts`): the pages
 *   at the end of last frame's order, then the empty pages. The grant's pop uses one atomic per
 *   thread, so the pages a grant takes are the list's end whatever the thread order; only which
 *   request takes which varies.
 * - The indirect args of the 16-tiles-per-page kernels are (16, pages, 1), not (16·pages, 1, 1), so
 *   2·PoolPages·16 groups never exceed maxComputeWorkgroupsPerDimension (65535). The kernel
 *   rebuilds the 1D group index as wid.y·16 + wid.x: the same tiles, the same pixels.
 * - Stats only when the module is built with `stats: true` (the stats permutation): one more storage
 *   buffer, the eighth of the page grant (its dispatcher's ids included).
 */
import {
  VSM_CONSTANTS_WGSL,
  VSM_COUNT_CLEARED,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_EMPTY_PAGES,
  VSM_COUNT_GRANTED,
  VSM_COUNT_WANTED,
  VSM_COUNT_STATIC_KEPT,
  VSM_COUNT_WPO_CONSIDERED,
} from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from './projection/projectionDataWgsl.ts'
import { VSM_PREFILTERED_WGSL, prefilteredDeps } from './prefilteredWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import { vsmPerPageDispatchWgsl } from './perPageDispatch.ts'
import { VSM_PER_PAGE_DISPATCH_WGSL, VSM_PER_PAGE_GROUP_XY } from './markingWgsl.ts'
import { VSM_FREE_PAGES_WGSL, VSM_PAGE_LISTS_WGSL } from './freePagesWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { type WgslDecl, wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'

/** Bind group indices of every page management kernel. */
export const VSM_PM_GROUP_RESOURCES = 0
export const VSM_PM_GROUP_PARAMS = 1
export const VSM_PM_GROUP_PER_PAGE = 2
/** Byte size of `VsmPmParams`; its slots lie the device's `uniformStride` apart. */
export const VSM_PM_PARAMS_BYTES = 28

/**
 * Loose parameters of the physical page kernels (update, address remap, ...): the next-map entries
 * this frame holds, whether last frame's pages are kept, whether a free page is taken by the age of
 * its last request (`shadowCacheAllocateViaLru`) and whether a page is cleared whole whatever it
 * holds (`shadowForceFullPageClears`) and whether the invalidations the pages carry are skipped
 * (`shadowCacheDebugSkipDynamicPageInvalidation`) (offsets 0, 4, 8, 12 and 16), and the page lists an
 * append copies from and to (`appendFrom`, `appendTo`, offsets 20 and 24: the slot of each append).
 */
const VSM_PM_PARAMS_WGSL = wgslBlock(
  'VSM_PM_PARAMS_WGSL',
  [],
  `
struct VsmPmParams{
 nextMapCount:u32,
 hasPrevFrame:u32,
 lruAllocation:u32,
 fullClears:u32,
 skipDynamicInvalidation:u32,
 appendFrom:u32,
 appendTo:u32,
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
function vsmPmModule(
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

/** Kernel `label`: its entry point (`vsm${label}` unless `options.entryPoint`), its group-0 `specs`
 *  and the module of `body` (`vsmPmModule`), dispatched per page when `options.perPage`. */
export const vsmPmKernel = (
  layout: VsmLayout,
  label: string,
  specs: VsmBindingSpec[],
  body: WgslDecl,
  options: { perPage?: boolean; stats?: boolean; entryPoint?: string } = {},
): VsmPmKernel => ({
  label,
  entryPoint: options.entryPoint ?? `vsm${label}`,
  specs,
  perPage: !!options.perPage,
  code: vsmPmModule(layout, specs, body, options),
})

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
${wgslConsts({
  VSM_COUNT_WANTED,
  VSM_COUNT_STATIC_KEPT,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_CLEARED,
  VSM_COUNT_GRANTED,
  VSM_COUNT_EMPTY_PAGES,
  VSM_COUNT_WPO_CONSIDERED,
})}
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
    // The previous frame's records: where its tables lay (\`vsmTableLevelOrigin\`).
    { resource: 'projectionData', binding: 4, prev: true, name: 'vsmProjectionData' },
  ]
  const body = wgslBlock(
    'carryPages',
    [VSM_CONSTANTS_WGSL, VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL],
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
  return vsmPmKernel(layout, 'CarryPages', specs, body)
}

/** The bits of a page's request that a held page is compared in and keeps: the fine bit, and with the
 *  prefiltered distant shadow the auxiliary ones too (`VSM_PAGE_AUX_MASK`). */
const requestMaskOf = (prefiltered: boolean) =>
  prefiltered ? 'VSM_PAGE_AUX_MASK' : 'VSM_PAGE_FINE'

/** The keep rule's invalidations: what a requested page holds of them, as the marks it is drawn
 *  with, and whether a deferred one keeps its mark. */
const keepInvalidationText = (requestMask: string) => /* wgsl */ `
const PM_REQUEST_MASK:u32=${requestMask};
/** A page whose dynamic invalidations are held: one of a map of one page (a distant light's), which
 *  takes none (its pages are refreshed in turn), or a coarse page of a map whose coarse pages keep
 *  their dynamic layer, drawn again for its static layer alone, both layers then. */
fn pmSkipDynamic(prevMeta:u32,requestFine:u32,projection:VsmProjectionData)->bool{
 let staticStale=(prevMeta&VSM_META_STATIC_STALE)!=0u&&!projection.distant;
 let keepDynamic=requestFine==0u&&projection.coarseDynamicCached;
 return projection.distant||(keepDynamic&&!staticStale);
}
fn pmKeepInvalidated(prevMeta:u32,requestFine:u32,projection:VsmProjectionData)->vec2u{
 let staticStale=(prevMeta&VSM_META_STATIC_STALE)!=0u&&!projection.distant;
 // The debug switch skips the whole block: the invalidations the page holds are not applied, and a
 // deferred one keeps its mark.
 let skipInvalidation=vsmPm.skipDynamicInvalidation!=0u;
 let dynamicHeld=pmSkipDynamic(prevMeta,requestFine,projection)||skipInvalidation;
 var marks=VSM_PAGE_WANTED;
 var keepDeferred=false;
 if(!skipInvalidation&&staticStale){
  marks|=VSM_PAGE_ANY_STALE;
 }else if(!dynamicHeld&&(prevMeta&VSM_META_DYNAMIC_STALE)!=0u){
  marks|=VSM_PAGE_DYNAMIC_STALE;
 }
 // An invalidation that waits (a cluster drawn coarser for want of its finer level) is carried
 // out within the frame's budget, both layers; over it, the page keeps the mark and tries again.
 if((prevMeta&VSM_META_DEFERRED)!=0u){
  if(dynamicHeld){
   keepDeferred=true;
  }else if(vsm.deferredBudget<0){
   marks|=VSM_PAGE_ANY_STALE;
  }else if(vsm.deferredBudget>0&&atomicAdd(&vsmRasterMarks[vsm.poolPages*VSM_DIRTY_SLICES],1u)<u32(vsm.deferredBudget)){
   marks|=VSM_PAGE_ANY_STALE;
  }else{
   keepDeferred=true;
  }
 }
 // A page drawn for the covered receivers alone may miss a caster: its dynamic layer is
 // drawn again each frame, but for a page whose dynamic invalidations are held.
 if(!dynamicHeld&&projection.useCover){
  marks|=VSM_PAGE_DYNAMIC_STALE;
 }
 return vec2u(marks,select(0u,1u,keepDeferred));
}
`

/** The keep rule for a page this frame wants: stamped, listed as requested, its marks and words
 *  settled. */
const keepRequestedText = /* wgsl */ `
fn pmKeepRequested(poolIndex:u32,prevMeta:u32,requestWord:u32,at:vec2u,projection:VsmProjectionData)->u32{
 let entryIndex=vsmTableIndex(at);
 let requestFine=requestWord&PM_REQUEST_MASK;
 let invalidated=pmKeepInvalidated(prevMeta,requestFine,projection);
 var nextMarks=invalidated.x;
 // Requested: stamped wanted now, out of the LRU list and into the requested one.
 vsmCount(VSM_COUNT_WANTED);
 pmPush(PM_LIST_REQUESTED,poolIndex);
 vsmPoolPageInfo[poolIndex].lastWantedStamp=vsm.frameStamp;
 // A page asked fine where it was held coarse, or the reverse, is drawn again whole.
 if(requestFine!=(prevMeta&PM_REQUEST_MASK)){
  nextMarks|=VSM_PAGE_STATIC_STALE|VSM_PAGE_DYNAMIC_STALE;
 }
 if((nextMarks&VSM_PAGE_STATIC_STALE)==0u){vsmCount(VSM_COUNT_STATIC_KEPT);}
 if((nextMarks&VSM_PAGE_DYNAMIC_STALE)==0u){vsmCount(VSM_COUNT_DYNAMIC_KEPT);}
 nextMarks|=requestFine;
 let viewBits=select(0u,VSM_META_VIEW_UNCACHED,projection.uncached);
 // The cleared bits carry over.
 var nextMeta=nextMarks|viewBits|(prevMeta&VSM_META_ANY_CLEARED);
 nextMeta|=select(0u,VSM_META_DEFERRED,invalidated.y!=0u);
 let drawsNow=(nextMarks&VSM_PAGE_ANY_STALE)!=0u;
 // A page an offset is allowed on, cached whole: its dynamic layer is marked stale so that the
 // raster's cull considers it (an offset that starts to move invalidates it), but it is neither
 // cleared nor drawn: its entry is not drawable and its words say nothing is stale.
 // (The debug switch does not skip it: it is no invalidation, and the reference keeps it, by the same single-page and coarse rule.)
 if(!pmSkipDynamic(prevMeta,requestFine,projection)&&(prevMeta&VSM_META_FORCE_CACHED)!=0u){
  nextMarks|=VSM_PAGE_DYNAMIC_STALE;
  vsmCount(VSM_COUNT_WPO_CONSIDERED);
 }
 // The page's entry (cleared again where a new map takes the page).
 vsmPageTableStore(entryIndex,vsmPackTableEntry(vsmPoolPageOf(poolIndex),drawsNow));
 vsmPageMarksStore(vsmPageMarkIndex(at,0u),nextMarks);
 return nextMeta;
}
`

/** The keep rule of one page and the kernel over the order of the pages: a page not asked keeps its
 *  words, or is emptied past its age. */
const keepPageText = /* wgsl */ `
/** A page not drawn this frame keeps its words, stale bits included, marked unseen. */
fn pmKeepUnseen(prevMeta:u32,at:vec2u)->u32{
 // Wanted, fine as it was drawn: the invalidation finds it — a fine caster's box too —, so a
 // caster that moves while nobody asks the page is not missed when it is asked again at the
 // same detail and served from the cache; the raster does not draw it.
 vsmPageMarksStore(vsmPageMarkIndex(at,0u),VSM_PAGE_WANTED|(prevMeta&VSM_PAGE_FINE));
 return prevMeta|VSM_META_UNSEEN;
}
/** The words page \`poolIndex\` is left with, and whether this frame asked it (1): no word when it is
 *  empty or unwanted past its age. */
fn pmKeepPage(poolIndex:u32)->vec2u{
 let prevInfo=vsmPoolPageInfo[poolIndex];
 if(prevInfo.flags==0u){return vec2u(0u,0u);}
 let handle=vsmHandleFromId(prevInfo.mapId);
 // Whether this frame's marking asked for the page again.
 let at=vsmTableEntryOf(handle,prevInfo.mipLevel,prevInfo.pageAddress).tableXY;
 let requestWord=vsmPageRequestsLoad(vsmTableIndex(at));
 let wantedNow=requestWord!=0u;
 let wantedAge=i32(vsm.frameStamp-prevInfo.lastWantedStamp);
 // A page of an unseen light stays whatever its age, until another map takes it.
 let projection=vsmProjectionOf(handle);
 if(!(wantedNow||projection.lightUnseen||wantedAge<=i32(vsm.pageKeepFrames))){return vec2u(0u,0u);}
 // The page keeps its map id and address: the slot already holds them.
 if(!wantedNow||projection.lightUnseen){return vec2u(pmKeepUnseen(prevInfo.flags,at),0u);}
 return vec2u(pmKeepRequested(poolIndex,prevInfo.flags,requestWord,at,projection),1u);
}
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmKeepPages(@builtin(global_invocation_id) index:vec3u){
 if(index.x>=vsm.poolPages){return;}
 // The page of this entry of last frame's order (the requested list), or the pool's own without one.
 // That order is whole only if every pass of the lists ran last frame (its count is the pool's):
 // a partial one would give a page to two entries, so the frame starts again from the pool's own order,
 // every page emptied, as the first frame does.
 let listIndex=index.x;
 var poolIndex=listIndex;
 var prevFrame=vsmPm.hasPrevFrame!=0u;
 if(prevFrame&&vsmPm.lruAllocation!=0u){
  prevFrame=vsmPrevFreePages[pmListAt(PM_LIST_REQUESTED,vsm.poolPages)]==vsm.poolPages;
  if(prevFrame){poolIndex=vsmPrevFreePages[pmListAt(PM_LIST_REQUESTED,listIndex)];}
 }
 var kept=vec2u(0u,0u);
 if(prevFrame){kept=pmKeepPage(poolIndex);}
 var removed=kept.y!=0u;
 // A page left with no word is empty: it leaves the LRU list for the empty one, which joins the
 // available pages at their end, taken first.
 if(kept.x==0u){
  vsmCount(VSM_COUNT_EMPTY_PAGES);
  pmPush(PM_LIST_EMPTY,poolIndex);
  removed=true;
 }
 vsmPoolPageInfo[poolIndex].flags=kept.x;
 // The LRU list in its order, what left it marked.
 pmListSet(PM_LIST_LRU,listIndex,select(poolIndex,PM_NONE,removed));
}
`

/** The keep rule, a thread an entry of last frame's order of the pool's pages (the pool's own
 *  without `lruAllocation`): a page this frame wants keeps its words, is stamped wanted now and goes
 *  to the requested list; one unwanted for `shadowCacheMaxPageAgeSinceLastRequest`, its light seen,
 *  is emptied and goes to the empty list; any other keeps its cached words and its place in the LRU
 *  list (`freePagesWgsl.ts`). */
function keepPages(layout: VsmLayout, o: VsmPmKernelOptions): VsmPmKernel {
  const specs = withStats(
    [
      { resource: 'uniforms', binding: 0 },
      { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
      { resource: 'pageRequests', binding: 2 },
      { resource: 'pageTable', binding: 3, access: 'read_write' },
      { resource: 'pageMarks', binding: 4, access: 'read_write' },
      { resource: 'projectionData', binding: 5 },
      // The deferred invalidations' count of the frame, after the raster marks' slices.
      { resource: 'rasterMarks', binding: 6, access: 'atomic' },
      // The page lists this frame builds, and last frame's requested list: its order.
      { resource: 'freePages', binding: 7, access: 'atomic' },
      { resource: 'freePages', binding: 8, prev: true },
    ],
    o.stats,
    9,
  )
  const requestMask = requestMaskOf(layout.prefilteredDistant)
  const body = wgslBlock(
    'keepPages',
    [
      STAT_WGSL,
      VSM_FREE_PAGES_WGSL,
      ...prefilteredDeps(layout.prefilteredDistant),
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
    ],
    `
${keepInvalidationText(requestMask)}${keepRequestedText}${keepPageText}
`,
  )
  return vsmPmKernel(layout, 'KeepPages', specs, body, { stats: !!o.stats })
}

/** The page lists' passes (`freePagesWgsl.ts`), one module, a kernel each entry: the lists reset
 *  before the keep rule, the LRU list packed after it, and the append of one list to another (the
 *  empty pages, then the available ones at the frame's end), a copy and its counts. */
function pageLists(layout: VsmLayout) {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'freePages', binding: 1, access: 'atomic' },
  ]
  const kernel = (label: string) => vsmPmKernel(layout, label, specs, VSM_PAGE_LISTS_WGSL)
  return {
    initPageLists: kernel('InitPageLists'),
    packAvailable: kernel('PackAvailable'),
    appendCopy: kernel('AppendCopy'),
    appendCounts: kernel('AppendCounts'),
  }
}

const grantPageText = (
  requestMask: string,
  packEntry: string,
) => /* wgsl */ `fn pmGrantPage(handle:VsmHandle,entryAt:VsmTableCell,mipLevel:u32,pageAddress:vec2u){
 let entryIndex=vsmTableIndex(entryAt.tableXY);
 let flagsIndex=vsmPageMarkIndex(entryAt.tableXY,0u);
 let requestWord=vsmPageRequestsLoad(entryIndex);
 if(requestWord==0u){return;}
 // A page already mapped needs no other.
 let pageMarks=vsmPageMarksLoad(flagsIndex)&VSM_PAGE_MARK_MASK;
 if(pageMarks!=0u){return;}
 vsmCount(VSM_COUNT_WANTED);
 // The available list's end: an empty page first, then the one left unrequested longest.
 let poolIndex=pmPop(PM_LIST_AVAILABLE);
 if(poolIndex<0i){
  // No free page: the request stays unmapped.
  return;
 }
 vsmCount(VSM_COUNT_GRANTED);
 let poolSlot=u32(poolIndex);
 pmPush(PM_LIST_REQUESTED,poolSlot);
 let poolPageXY=vsmPoolPageOf(poolSlot);
 // The map that held this pool page loses its entry first.
 let prevInfo=vsmPoolPageInfo[poolSlot];
 if((prevInfo.flags&VSM_PAGE_WANTED)!=0u){
  let prevOffset=vsmTableEntryOf(vsmHandleFromId(prevInfo.mapId),prevInfo.mipLevel,prevInfo.pageAddress);
  vsmPageTableStore(vsmTableIndex(prevOffset.tableXY),0u);
  vsmPageMarksStore(vsmPageMarkIndex(prevOffset.tableXY,0u),0u);
 }
 let requestFine=requestWord&${requestMask};
 let flags=VSM_PAGE_WANTED|VSM_PAGE_DYNAMIC_STALE|VSM_PAGE_STATIC_STALE|requestFine;
 // A new page is drawn whole.
 vsmPageTableStore(entryIndex,${packEntry});
 vsmPageMarksStore(flagsIndex,flags);
 let projection=vsmProjectionOf(handle);
 let viewBits=select(0u,VSM_META_VIEW_UNCACHED,projection.uncached);
 // A reused page keeps none of its cleared bits.
 vsmPoolPageInfo[poolSlot].flags=flags|viewBits;
 vsmPoolPageInfo[poolSlot].lastWantedStamp=vsm.frameStamp;
 vsmPoolPageInfo[poolSlot].mapId=handle.id;
 vsmPoolPageInfo[poolSlot].mipLevel=mipLevel;
 vsmPoolPageInfo[poolSlot].pageAddress=pageAddress;
}`

const grantKernelText = () => /* wgsl */ `
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
}`

/** Maps the newly requested pages onto available physical pages, driven by the per-page dispatcher. */
function grantPages(layout: VsmLayout, o: VsmPmKernelOptions): VsmPmKernel {
  const specs = withStats(
    [
      { resource: 'uniforms', binding: 0 },
      { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
      { resource: 'freePages', binding: 2, access: 'atomic' },
      { resource: 'pageRequests', binding: 3 },
      { resource: 'pageTable', binding: 4, access: 'read_write' },
      { resource: 'pageMarks', binding: 5, access: 'read_write' },
      { resource: 'projectionData', binding: 6 },
    ],
    o.stats,
    7,
  )
  const requestMask = requestMaskOf(layout.prefilteredDistant)
  // The page asked by a finer level's page is the secondary request's.
  const packEntry = layout.prefilteredDistant
    ? 'vsmPackSecondaryTableEntry(poolPageXY,(requestFine&VSM_PAGE_SECONDARY)!=0u)'
    : 'vsmPackTableEntry(poolPageXY,true)'
  const body = wgslBlock(
    'grantPages',
    [
      STAT_WGSL,
      ...prefilteredDeps(layout.prefilteredDistant),
      VSM_FREE_PAGES_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_PER_PAGE_DISPATCH_WGSL,
    ],
    `
${grantPageText(requestMask, packEntry)}${grantKernelText()}
`,
  )
  return vsmPmKernel(layout, 'GrantPages', specs, body, { perPage: true, stats: !!o.stats })
}

/** The clears' indirect arguments in their empty form: 16 tile groups a page, no page, 1, and a word of padding. */
export const VSM_CLEAR_ARGS_EMPTY = [16, 0, 1, 0] as const

/** Sets the clears' indirect arguments to their empty form (`VSM_CLEAR_ARGS_EMPTY`), before the kernel
 *  that lists the pages to clear adds to them. */
function resetClearArgs(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [{ resource: 'clearArgs', binding: 0, access: 'atomic' }]
  const body = wgslBlock(
    'resetClearArgs',
    [],
    `
@compute @workgroup_size(1)
fn vsmResetClearArgs(){
${VSM_CLEAR_ARGS_EMPTY.map((word, k) => ` atomicStore(&vsmClearArgs[${k}],${word}u);`).join('\n')}
}
`,
  )
  return vsmPmKernel(layout, 'ResetClearArgs', specs, body)
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
 let forceCached=(pageInfo.flags&VSM_META_FORCE_CACHED)!=0u;
 if((pageInfo.flags&VSM_PAGE_WANTED)==0u){
  // No map holds the page.
 }else if(unreferenced||fullyCached||forceCached){
  // Kept whole, or its light unseen, or cached whole though an offset is allowed on it: the page is
  // left as it is.
 }else{
  var clearedFlags=0u;
  // Its static layer, unless cleared already and full clears are off.
  if((pageInfo.flags&VSM_PAGE_STATIC_STALE)!=0u&&(pageInfo.flags&VSM_META_VIEW_UNCACHED)==0u){
   if(vsmPm.fullClears!=0u||(pageInfo.flags&VSM_META_STATIC_CLEARED)==0u){
    pmListClear(poolIndex+vsm.poolPages);
    vsmCount(VSM_COUNT_CLEARED);
    clearedFlags|=VSM_META_STATIC_CLEARED|VSM_META_STATIC_DRAWN;
   }
  }
  // Its dynamic layer, unless cleared already; always when the static one was (its copy is stale).
  if(vsmPm.fullClears!=0u||(pageInfo.flags&VSM_META_DYNAMIC_CLEARED)==0u||clearedFlags!=0u){
   pmListClear(poolIndex);
   vsmCount(VSM_COUNT_CLEARED);
   clearedFlags|=VSM_META_DYNAMIC_CLEARED|VSM_META_DYNAMIC_DRAWN;
  }
  vsmPoolPageInfo[poolIndex].flags=pageInfo.flags|clearedFlags;
 }
}
`,
  )
  return vsmPmKernel(layout, 'ListClears', specs, body, { stats: !!o.stats })
}

/** Tile setup of the 16-tiles-per-page kernels (16x16 threads, 32x32 texels per tile): the clears
 *  and the occlusion pyramid's build (`occlusion/occlusionWgsl.ts`). */
export const TILE_WGSL = wgslBlock(
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
  return vsmPmKernel(layout, 'ClearPages', specs, body)
}

/** The pages the prefiltered distant shadow filters, listed as the pages to merge are: a page held and
 *  seen, asked by a finer level's page (`VSM_PAGE_SECONDARY`), of a map that holds the prefiltered
 *  shadow. Each goes in the separable passes' list (a thread group a row of it, `VSM_FILTER_ARGS_SEPARABLE`),
 *  in the merge down's (`VSM_FILTER_ARGS_MERGE`) and in the border's count (`VSM_FILTER_ARGS_BORDER`). */
const SELECT_FILTERABLE = {
  specs: [
    { resource: 'filterableArgs', binding: 4, access: 'atomic' },
    { resource: 'filterablePages', binding: 5, access: 'read_write' },
    { resource: 'projectionData', binding: 6 },
  ] as VsmBindingSpec[],
  deps: [VSM_PREFILTERED_WGSL, VSM_HANDLE_WGSL, VSM_PROJECTION_DATA_READ_WGSL],
  text: /* wgsl */ `
 if((flags&VSM_PAGE_WANTED)!=0u&&(flags&VSM_META_UNSEEN)==0u&&(flags&VSM_PAGE_SECONDARY)!=0u){
  if(vsmMapPrefiltered(vsmProjectionOf(vsmHandleFromId(vsmPoolPageInfo[poolIndex].mapId)))){
   let separableAt=atomicAdd(&vsmFilterableArgs[VSM_FILTER_ARGS_SEPARABLE*VSM_FILTER_ARGS_SET_WORDS+1u],1u);
   vsmFilterablePagesStore(VSM_FILTER_LIST_SEPARABLE*vsm.poolPages+separableAt,poolIndex);
   let mergeAt=atomicAdd(&vsmFilterableArgs[VSM_FILTER_ARGS_MERGE*VSM_FILTER_ARGS_SET_WORDS+1u],1u);
   vsmFilterablePagesStore(VSM_FILTER_LIST_FILTERABLE*vsm.poolPages+mergeAt,poolIndex);
   atomicAdd(&vsmFilterableArgs[VSM_FILTER_ARGS_BORDER*VSM_FILTER_ARGS_SET_WORDS],1u);
  }
 }`,
}

/**
 * Lists the pages whose static layer was drawn this frame, to merge it into the dynamic layer
 * (`clearArgs` and `pagesToClear` again, empty after the frame's clears): a page held by a map that
 * is seen, whose view is cached, with its static layer drawn or cleared (`VSM_META_STATIC_DRAWN`).
 * With the prefiltered distant shadow it also lists the pages the filters process
 * (`SELECT_FILTERABLE`).
 */
function selectMerges(layout: VsmLayout): VsmPmKernel {
  const { specs, deps, text } = layout.prefilteredDistant
    ? SELECT_FILTERABLE
    : { specs: [], deps: [], text: '' }
  const body = wgslBlock(
    'selectMerges',
    [VSM_CONSTANTS_WGSL, ...deps],
    `
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmSelectMerges(@builtin(global_invocation_id) id:vec3u){
 let poolIndex=id.x;
 if(poolIndex>=vsm.poolPages){return;}
 let flags=vsmPoolPageInfo[poolIndex].flags;${text}
 if((flags&VSM_PAGE_WANTED)!=0u&&(flags&VSM_META_UNSEEN)==0u&&(flags&VSM_META_VIEW_UNCACHED)==0u&&(flags&VSM_META_STATIC_DRAWN)!=0u){
  let slot=atomicAdd(&vsmClearArgs[1],1u);
  vsmPagesToClearStore(slot,poolIndex);
 }
}
`,
  )
  const plain: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolPageInfo', binding: 1 },
    { resource: 'clearArgs', binding: 2, access: 'atomic' },
    { resource: 'pagesToClear', binding: 3, access: 'read_write' },
  ]
  return vsmPmKernel(layout, 'SelectMerges', [...plain, ...specs], body)
}

/** Merges the static layer of the listed pages into the dynamic one, one tile per group: the deeper
 *  of the two texels (reversed depth: the greater word) becomes the dynamic layer's. */
function mergePages(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'pagesToClear', binding: 1 },
    { resource: 'pagePool', binding: 2, access: 'read_write' },
  ]
  const body = wgslBlock(
    'mergePages',
    [TILE_WGSL, VSM_CONSTANTS_WGSL],
    `
@compute @workgroup_size(16,16)
fn vsmMergePages(@builtin(local_invocation_id) tileThreadId:vec3u,@builtin(workgroup_id) wid:vec3u){
 let groupIndex=pmGroupIndex(wid);
 let setup=pmTileOf(groupIndex,vsmPagesToClearLoad(groupIndex>>PM_LOG2_TILES));
 let firstTexel=pmTileOffset(setup)+tileThreadId.xy;
 let stride=PM_TILE_LANES;
 var o=array<vec2u,4>(vec2u(0u,0u),vec2u(stride,0u),vec2u(0u,stride),vec2u(stride,stride));
 for(var k=0u;k<4u;k++){
  let texel=firstTexel+o[k];
  vsmPoolStore(texel,0u,max(vsmPoolLoad(texel,0u),vsmPoolLoad(texel,1u)));
 }
}
`,
  )
  return vsmPmKernel(layout, 'MergePages', specs, body)
}

/** The status feedback → `res.feedback` = [VSM_FEEDBACK_POOL, free pages (i32), pressure bias (f32 bits)]. */
function poolFeedback(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'freePages', binding: 1, access: 'atomic' },
    { resource: 'feedback', binding: 2, access: 'read_write' },
  ]
  const body = wgslBlock(
    'poolFeedback',
    [VSM_FREE_PAGES_WGSL, VSM_CONSTANTS_WGSL],
    `
@compute @workgroup_size(1)
fn vsmPoolFeedback(){
 vsmFeedbackStore(0u,0u);
 // Pages still available.
 vsmFeedbackStore(1u,bitcast<u32>(pmFreeCount()));
 // This frame's pressure bias.
 vsmFeedbackStore(2u,bitcast<u32>(vsm.pressureBias));
}
`,
  )
  return vsmPmKernel(layout, 'PoolFeedback', specs, body)
}

/**
 * A page's raster marks folded into its metadata and cleared, its words returned: each mark read and cleared; a page drawn this frame
 * is cleared no longer and drawn, its invalidations joining its stale bits. Read through the
 * module's `rasterMarks` (read-write) and `poolPageInfo` (read-write): the fold after the raster
 * (`foldRasterMarks`) and the occlusion pyramid's page selection (`occlusion/occlusionWgsl.ts`).
 */
export const VSM_FOLD_RASTER_MARKS_WGSL = wgslBlock(
  'VSM_FOLD_RASTER_MARKS_WGSL',
  [VSM_CONSTANTS_WGSL],
  `
fn pmFoldRasterMarks(poolIndex:u32)->u32{
 let n=vsm.poolPages;
 let dynamicDrawn=vsmRasterMarksLoad(poolIndex+0u*n)!=0u;
 let staticDrawn=vsmRasterMarksLoad(poolIndex+1u*n)!=0u;
 let invalidatesDynamic=vsmRasterMarksLoad(poolIndex+2u*n)!=0u;
 let invalidatesStatic=vsmRasterMarksLoad(poolIndex+3u*n)!=0u;
 let offsetAllowed=vsmRasterMarksLoad(poolIndex+4u*n)!=0u;
 let lodDelta=vsmRasterMarksLoad(poolIndex+5u*n)!=0u;
 for(var s=0u;s<VSM_DIRTY_SLICES;s++){vsmRasterMarksStore(poolIndex+s*n,0u);}
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
   |select(0u,VSM_META_STATIC_STALE,invalidatesStatic)
   |select(0u,VSM_META_FORCE_CACHED,offsetAllowed)
   |select(0u,VSM_META_DEFERRED,lodDelta);
  vsmPoolPageInfo[poolIndex].flags=flags;
 }
 return flags;
}
`,
)

/**
 * After the render, a thread a page: folds the raster marks into the page metadata
 * (`VSM_FOLD_RASTER_MARKS_WGSL`). Slice 0 is whole after the
 * raster: a static caster drawing a page's static layer writes slice 0 too
 * (`render/renderRasterWgsl.ts`), the page's dynamic layer cleared and drawn again that frame. An
 * unreferenced page is not drawn this frame: its marks are an older frame's. With the occlusion
 * culling on, the pyramid's last page selection folded them already: none is left.
 */
function foldRasterMarks(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'rasterMarks', binding: 1, access: 'read_write' },
    { resource: 'poolPageInfo', binding: 2, access: 'read_write' },
  ]
  const body = wgslBlock(
    'foldRasterMarks',
    [VSM_CONSTANTS_WGSL, VSM_FOLD_RASTER_MARKS_WGSL],
    `
// The frame clears the marks before its raster too (\`vsmEncode.ts\`).
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmFoldRasterMarks(@builtin(global_invocation_id) id:vec3u){
 let poolIndex=id.x;
 if(poolIndex>=vsm.poolPages){return;}
 pmFoldRasterMarks(poolIndex);
}
`,
  )
  return vsmPmKernel(layout, 'FoldRasterMarks', specs, body)
}

/** Every page management kernel for `layout`. */
export function vsmPhysicalPageKernels(layout: VsmLayout, options: VsmPmKernelOptions = {}) {
  return {
    carryPages: carryPages(layout),
    keepPages: keepPages(layout, options),
    ...pageLists(layout),
    grantPages: grantPages(layout, options),
    resetClearArgs: resetClearArgs(layout),
    listClears: listClears(layout, options),
    clearPages: clearPages(layout),
    poolFeedback: poolFeedback(layout),
    foldRasterMarks: foldRasterMarks(layout),
    selectMerges: selectMerges(layout),
    mergePages: mergePages(layout),
  }
}
