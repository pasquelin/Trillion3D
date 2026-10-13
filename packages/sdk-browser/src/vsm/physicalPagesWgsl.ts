import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
/**
 * Physical page management kernels.
 *
 * Each kernel is a complete WGSL module built for one `VsmLayout`: group 0 holds the VSM resources
 * (binding specs exported with the kernel, built by `vsmBindingsWgsl`), group 1 the loose shader
 * parameters (`VsmPmParams`, one dynamic-offset slot per dispatch variant), group 2 the per-page
 * dispatcher (`perPageDispatch.ts`) for the per-page kernels.
 *
 * Invariants of the kernels (WebGPU has no wave operations and at most 256 threads per group):
 * - The free pages are the pool sort's queue (`freePagesWgsl.ts`), in the pool rank's order: the
 *   grant's pop and the page-to-process emit use one atomic per thread, so the pages a grant takes
 *   are the queue's head whatever the thread order; only which request takes which varies.
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
import { VSM_FREE_PAGES_WGSL, VSM_POOL_SORT_WGSL } from './freePagesWgsl.ts'
import { POOL_SORT_STAGES } from '../gpu/pool/sort.ts'
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
  return vsmPmKernel(layout, 'CarryPages', specs, body)
}

/** The keep rule, a thread a pool page: a page this frame wants keeps its words and is stamped
 *  wanted now; one unwanted for `VSM_PAGE_KEEP_FRAMES`, its light seen, is emptied; any other
 *  keeps its cached words. The free pages' order is the pool sort's (`freePagesWgsl.ts`). */
function keepPages(layout: VsmLayout, o: VsmPmKernelOptions): VsmPmKernel {
  const specs = withStats(
    [
      { resource: 'uniforms', binding: 0 },
      { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
      { resource: 'pageRequests', binding: 2 },
      { resource: 'pageTable', binding: 3, access: 'read_write' },
      { resource: 'pageMarks', binding: 4, access: 'read_write' },
      { resource: 'projectionData', binding: 5 },
    ],
    o.stats,
    6,
  )
  const body = wgslBlock(
    'keepPages',
    [
      STAT_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
    ],
    `
/** Frames a page unrequested since stays kept (\`VSM_PAGE_KEEP_FRAMES\`). */
const PM_PAGE_KEEP_FRAMES:i32=${VSM_PAGE_KEEP_FRAMES}i;
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmKeepPages(@builtin(global_invocation_id) index:vec3u){
 if(index.x>=vsm.poolPages){return;}
 let poolIndex=index.x;
 var nextMeta=0u;
 if(vsmPm.hasPrevFrame!=0u){
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
     // Requested: stamped wanted now, the page is in use (\`poolInUse\`).
     vsmCount(VSM_COUNT_WANTED);
     vsmPoolPageInfo[poolIndex].lastWantedStamp=vsm.frameStamp;
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
 // A page left with no word is empty: the pool sort lists it first.
 vsmPoolPageInfo[poolIndex].flags=nextMeta;
}
`,
  )
  return vsmPmKernel(layout, 'KeepPages', specs, body, { stats: !!o.stats })
}

/** The pool sort's three stages over the shadow pool (`freePagesWgsl.ts`), one module: the free
 *  pages in the pool rank's order, after the keep rule. */
function poolSort(layout: VsmLayout) {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolPageInfo', binding: 1 },
    { resource: 'projectionData', binding: 2 },
    { resource: 'freePages', binding: 3, access: 'atomic' },
  ]
  return Object.fromEntries(
    POOL_SORT_STAGES.map((entryPoint) => [
      entryPoint,
      vsmPmKernel(layout, entryPoint, specs, VSM_POOL_SORT_WGSL, { entryPoint }),
    ]),
  ) as Record<(typeof POOL_SORT_STAGES)[number], VsmPmKernel>
}

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
  const body = wgslBlock(
    'grantPages',
    [
      STAT_WGSL,
      VSM_FREE_PAGES_WGSL,
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
 // The pool sort's head: an empty page first, then the one wanted longest ago.
 let poolIndex=pmPop();
 if(poolIndex<0i){
  // No free page: the request stays unmapped.
  return;
 }
 vsmCount(VSM_COUNT_GRANTED);
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
  return vsmPmKernel(layout, 'GrantPages', specs, body, { perPage: true, stats: !!o.stats })
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
  return vsmPmKernel(layout, 'ListClears', specs, body, { stats: !!o.stats })
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
  return vsmPmKernel(layout, 'ClearPages', specs, body)
}

/** The status feedback → `res.feedback` = [VSM_FEEDBACK_POOL, free pages (i32), pressure bias (f32 bits), scene frame]. */
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
 // Frame tag of the message.
 vsmFeedbackStore(3u,vsm.frameStamp);
}
`,
  )
  return vsmPmKernel(layout, 'PoolFeedback', specs, body)
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
  return vsmPmKernel(layout, 'FoldRasterMarks', specs, body)
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
  return vsmPmKernel(layout, 'TileDepthsBuild', specs, body)
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
  return vsmPmKernel(layout, 'MergeStatic', specs, body)
}

/** Every page management kernel for `layout`. */
export function vsmPhysicalPageKernels(layout: VsmLayout, options: VsmPmKernelOptions = {}) {
  return {
    carryPages: carryPages(layout),
    keepPages: keepPages(layout, options),
    ...poolSort(layout),
    grantPages: grantPages(layout, options),
    listClears: listClears(layout, options),
    clearPages: clearPages(layout),
    poolFeedback: poolFeedback(layout),
    foldRasterMarks: foldRasterMarks(layout),
    mergeStatic: mergeStatic(layout),
    tileDepthsBuild: tileDepthsBuild(layout),
  }
}
