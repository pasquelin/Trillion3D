/**
 * Page marking (step 3): the WGSL of the first passes of the page marking —
 * - the page table clear with its per-page dispatch setup;
 * - the page rect bounds init;
 * - the coarse page marking;
 * - the page marks from the pixels and its marking helpers (biased clipmap level, local mip
 *   level, page address, page receiver cover, directional and local marking), the clipmap level
 *   and local footprint, and the back-face tests against directional and local lights.
 *
 * Texture writes become storage-buffer writes (`vsm*Store` / `vsm*Or` from the binding builder);
 * an out-of-range texel, which a storage texture write discards, is skipped by an explicit bounds test.
 *
 * Pixel inputs are the engine's own (the shadow demand pass's, `webgpu/shadow/demandWgsl.ts`):
 * depth, normals, surface flags, the deferred `View` and `worldAt`, and the light grid
 * (`pixelCell`, `cellSlice`, `tileLights`) in place of a pruned light grid.
 * What the engine's view uniform lacks (the +z-forward view-to-clip matrix, the depth-from-device-Z
 * coefficients, the origin shift, the view rect) comes in `VsmMarkingParams` (`markingPass.ts`).
 */
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_STRUCTS_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from './resources.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../lighting/deferred/shaders.ts'
import { DIRECT_LIGHT_WGSL } from '../lighting/direct/lightWgsl.ts'
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../lighting/direct/lightingWgsl.ts'
import { SUBSURFACE_FLAG } from '../scene/subsurface.ts'
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts'
import type { VsmLayout } from './layout.ts'

/** The group side of the page marks from pixels pass. */
export const VSM_MARK_PIXELS_GROUP_XY = 8
/** The group side of the per-page shaders. */
export const VSM_PER_PAGE_GROUP_XY = 8
/** Byte size of `VsmMarkingParams`. */
export const VSM_MARKING_PARAMS_BYTES = 160
/** Byte size of one `VsmMapWalkParams` slot (uniform dynamic-offset alignment). */
export const VSM_PER_PAGE_DISPATCH_STRIDE = 256

/**
 * The marking passes' own parameters (the page marks generation, coarse marking and page rect
 * bounds scalars) and the map view.
 * Offsets: 0 viewToClip, 64 depthFromDeviceZ, 80 originShiftHigh,
 * 92 sunMarginPages, 96 originShiftLow, 108 localMarginPages,
 * 112 viewRectMin, 120 viewSize, 128 pixelStride, 136 sunMapCount,
 * 140 skipBackFaces, 144 rectsToClear, 148 coarseLocal,
 * 152 pad.
 */
const VSM_MARKING_PARAMS_WGSL = /* wgsl */ `
struct VsmMarkingParams{
 viewToClip:mat4x4f,
 depthFromDeviceZ:vec4f,
 originShiftHigh:vec3f,
 sunMarginPages:f32,
 originShiftLow:vec3f,
 localMarginPages:f32,
 viewRectMin:vec2u,
 viewSize:vec2u,
 pixelStride:vec2u,
 sunMapCount:u32,
 skipBackFaces:u32,
 rectsToClear:u32,
 coarseLocal:u32,
 _pad:u32,
}
`

const COMMON_WGSL =
  VSM_CONSTANTS_WGSL +
  VSM_UNIFORMS_WGSL +
  VSM_HANDLE_WGSL +
  VSM_STRUCTS_WGSL +
  VSM_PAGE_ADDRESS_WGSL +
  VSM_PROJECTION_DATA_WGSL

// ---- Page table reset ------------------------------------------------------------------------

/** What a page table clear variant clears: one of the 2D tables, its mip count and sample stride. */
export type VsmClearTarget = 'pageRequests' | 'pageTable' | 'pageMarks' | 'receiverCover'

/** The tables one walk of the maps' pages clears, by the maps it walks: every map (`all`) — the
 *  request flags, the page table and flags, and a receiver cover that holds every map's —, and a
 *  receiver cover that holds the suns' alone, which walks the suns' maps (`directionalOnly`). */
export function vsmMarkingClears(layout: VsmLayout) {
  const all: VsmClearTarget[] = ['pageRequests', 'pageTable', 'pageMarks']
  if (layout.coverMode === 'local') all.push('receiverCover')
  const directionalOnly: VsmClearTarget[] =
    layout.coverMode === 'directional' ? ['receiverCover'] : []
  return { all, directionalOnly }
}

/** The mips and sample stride of each table as the marking pass allocates it. */
function vsmClearTargetShape(target: VsmClearTarget, layout: VsmLayout) {
  switch (target) {
    case 'pageMarks':
      return { numMips: layout.markMips, sampleStride: 1 }
    case 'receiverCover':
      return { numMips: layout.coverMips, sampleStride: 2 }
    default:
      return { numMips: 1, sampleStride: 1 }
  }
}

/** Bindings of the clear: 0 uniforms, 1 projection data, 2 per-page ids; 3 dispatch (dynamic), 4 dest. */
export const VSM_CLEAR_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 1 },
  { resource: 'perPageIds', binding: 2 },
]

/**
 * The per-page dispatch setup. Needs `vsmPerPageIds`,
 * `vsmPerPage` (VsmMapWalkParams) and `vsmProjectionData`.
 */
export const VSM_PER_PAGE_DISPATCH_WGSL = /* wgsl */ `
struct VsmMapWalkParams{idStart:u32,idCount:u32,gridWidth:u32,threadPerId:u32,}
struct VsmMapWalk{
 valid:bool,
 handle:VsmHandle,
 walkStart:vec2u,
 walkStep:u32,
 firstMip:u32,
 endMip:u32,
}
fn vsmMapWalkOf(dispatchThreadId:vec3u)->VsmMapWalk{
 var s:VsmMapWalk;
 s.valid=false;
 s.handle=vsmHandleInvalid();
 if(vsmPerPage.threadPerId!=0u){
  s.walkStart=vec2u(0u);
  s.walkStep=1u;
  let threadIndex=dispatchThreadId.y*vsmPerPage.gridWidth+dispatchThreadId.x;
  if(threadIndex>=vsmPerPage.idCount){return s;}
  s.handle=vsmHandleFromId(vsmPerPageIds[vsmPerPage.idStart+threadIndex]);
 }else{
  s.handle=vsmHandleFromId(vsmPerPageIds[vsmPerPage.idStart+dispatchThreadId.z]);
  s.walkStart=dispatchThreadId.xy;
  s.walkStep=vsmPerPage.gridWidth;
 }
 s.valid=true;
 if(s.handle.isSinglePage){
  s.firstMip=VSM_MIPS-1u;
  s.endMip=VSM_MIPS;
 }else{
  let pd=vsmProjectionData[s.handle.id];
  s.firstMip=pd.finestMip;
  s.endMip=select(VSM_MIPS,1u,pd.lightKind==LIGHT_KIND_DIRECTIONAL);
 }
 return s;
}
fn vsmPagesAcross(mipLevel:u32)->u32{return VSM_LEVEL0_PAGES>>mipLevel;}
`

/**
 * The clears of several tables in one walk of each map's pages (`targets`, each its own `numMips`
 * and `sampleStride`): every table a texel of a page clears is cleared there, as one kernel a table
 * cleared it; the clear value is 0, the only value the marking pass clears with. Entry
 * `vsmClearPageTables`, 8x8; binding 4 + n is the n-th target.
 */
export function vsmResetPageTableWgsl(targets: readonly VsmClearTarget[], layout: VsmLayout) {
  const tables = targets.map((target, n) => {
    const { numMips, sampleStride } = vsmClearTargetShape(target, layout)
    const size = target === 'receiverCover' ? 'vsm.coverSize' : 'vsm.pageTableSize'
    const mipOffset =
      target === 'pageMarks'
        ? 'vsmMarkMipOffset(m)'
        : target === 'receiverCover'
          ? 'vsmCoverMipOffset(m)'
          : '0u'
    const store = `vsmClearStore${n}`
    const body =
      sampleStride === 2
        ? [
            `let a${n}=po.tableXY*2u;`,
            ...[0, 1].flatMap((y) => [0, 1].map((x) => `${store}(a${n}+vec2u(${x}u,${y}u),0u);`)),
          ]
        : [`${store}(po.tableXY,0u);`]
    for (let h = 1; h < numMips; h++)
      body.push(`vsmClearMip${n}(${h}u,lo,page,${sampleStride}u,mipLevel);`)
    return {
      declarations: `@group(0) @binding(${4 + n}) var<storage,read_write> vsmClearDest${n}:array<u32>;
/** Texel t of mip m of ${target}; a texel past the mip is dropped, as a storage texture drops it. */
fn ${store}(t:vec2u,m:u32){
 let dims=max(vec2u(1u),${size}>>vec2u(m));
 if(any(t>=dims)){return;}
 vsmClearDest${n}[${mipOffset}+t.y*dims.x+t.x]=VSM_CLEAR_VALUE;
}
/** Clears one mip of ${target}. */
fn vsmClearMip${n}(pyramidLevel:u32,levelOffset:VsmTableLevel,pageCoord:vec2u,sampleStrideLocal:u32,mipLevel:u32){
 let levelDim=vsmPagesAtLevel(mipLevel+pyramidLevel)*sampleStrideLocal;
 let pyramidFirst=(levelOffset.firstCell*sampleStrideLocal)>>vec2u(pyramidLevel);
 if(all(pageCoord<vec2u(levelDim))){${store}(pyramidFirst+pageCoord,pyramidLevel);}
}`,
      body: body.map((line) => `    ${line}`).join('\n'),
    }
  })
  return `${COMMON_WGSL}
${vsmBindingsWgsl(0, VSM_CLEAR_SPECS, layout)}
@group(0) @binding(3) var<uniform> vsmPerPage:VsmMapWalkParams;
${VSM_PER_PAGE_DISPATCH_WGSL}
const VSM_CLEAR_VALUE:u32=0u;
${tables.map((t) => t.declarations).join('\n')}
@compute @workgroup_size(${VSM_PER_PAGE_GROUP_XY},${VSM_PER_PAGE_GROUP_XY}) fn vsmClearPageTables(@builtin(global_invocation_id) dispatchThreadId:vec3u){
 let setup=vsmMapWalkOf(dispatchThreadId);
 if(!setup.valid){return;}
 for(var mipLevel=setup.firstMip;mipLevel<setup.endMip;mipLevel++){
  let lo=vsmTableLevelOrigin(setup.handle,mipLevel);
  let loopEndXY=vsmPagesAcross(mipLevel);
  for(var pageY=setup.walkStart.y;pageY<loopEndXY;pageY+=setup.walkStep){
   for(var pageX=setup.walkStart.x;pageX<loopEndXY;pageX+=setup.walkStep){
    let page=vec2u(pageX,pageY);
    let po=vsmTableEntryAt(lo,mipLevel,page);
${tables.map((t) => t.body).join('\n')}
   }
  }
 }
}
`
}

// ---- Page rect init --------------------------------------------------------------------------

export const VSM_INIT_RECT_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'staleRects', binding: 1, access: 'read_write' },
  { resource: 'mappedRects', binding: 2, access: 'read_write' },
  { resource: 'poolLists', binding: 3, access: 'read_write' },
]

/** The page rect bounds init, entry `vsmInitPageRects`, 256 threads. Binding 4: params. */
export const vsmPageRectInitWgsl = (layout: VsmLayout) => `${COMMON_WGSL}
${VSM_MARKING_PARAMS_WGSL}
${vsmBindingsWgsl(0, VSM_INIT_RECT_SPECS, layout)}
@group(0) @binding(4) var<uniform> vsmMarking:VsmMarkingParams;
/** Start and count access of the physical page lists. */
fn vsmPageListStart(pageList:u32)->u32{return pageList*(vsm.poolPages+1u);}
fn vsmSetPageListCount(pageList:u32,newCount:i32){
 vsmPoolLists[vsmPageListStart(pageList)+vsm.poolPages]=newCount;
}
@compute @workgroup_size(${256}) fn vsmInitPageRects(@builtin(global_invocation_id) index:vec3u){
 if(index.x<vsmMarking.rectsToClear){
  var rectOffset=index.x;
  // The full shadow maps are offset to a distant part of the ID range.
  if(index.x>=vsm.singlePageMapCount*VSM_MIPS){
   rectOffset+=VSM_SINGLE_PAGE_MAP_SLOTS*VSM_MIPS-vsm.singlePageMapCount*VSM_MIPS;
  }
  let empty=vec4u(VSM_LEVEL0_PAGES,VSM_LEVEL0_PAGES,0u,0u);
  vsmStaleRects[rectOffset]=empty;
  vsmMappedRects[rectOffset]=empty;
 }
 // Clear the various list counters.
 if(index.x==0u){
  vsmSetPageListCount(VSM_PAGES_BY_AGE,i32(vsm.poolPages));
  vsmSetPageListCount(VSM_PAGES_FREE,0);
  vsmSetPageListCount(VSM_PAGES_EMPTY,0);
  vsmSetPageListCount(VSM_PAGES_REQUESTED,0);
 }
}
`

// ---- Marking helpers ----------------------------------------

/**
 * Requests a page, and fills its whole receiver cover. Needs
 * `vsmPageRequestsStore` and, for the full-page mask, `vsmReceiverCoverStore`.
 */
const VSM_MARK_PAGE_ADDRESS_WGSL = /* wgsl */ `
fn vsmRequestPage(entryCell:VsmTableCell,flags:u32){
 let t=entryCell.tableXY;
 if(all(t<vsm.pageTableSize)){vsmPageRequestsStore(vsmTableIndex(t),flags);}
}
`
const VSM_FILL_COVER_WGSL = /* wgsl */ `
fn vsmCoverStore0(t:vec2u,v:u32){if(vsmCoverInBounds(t,0u)){vsmReceiverCoverStore(vsmCoverIndex(t,0u),v);}}
fn vsmFillCover(entryCell:VsmTableCell){
 let a=entryCell.tableXY*2u;
 vsmCoverStore0(a+vec2u(0u,0u),0xFFFFu);
 vsmCoverStore0(a+vec2u(1u,0u),0xFFFFu);
 vsmCoverStore0(a+vec2u(0u,1u),0xFFFFu);
 vsmCoverStore0(a+vec2u(1u,1u),0xFFFFu);
}
`

// ---- Coarse marking --------------------------------------------------------------------------

export const VSM_COARSE_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 1 },
  { resource: 'pageRequests', binding: 2, access: 'read_write' },
  { resource: 'receiverCover', binding: 3, access: 'read_write' },
]

/** The coarse page marking, entry `vsmMarkCoarse`, 256 threads. Binding 4: params. */
export const vsmCoarseMarkingWgsl = (layout: VsmLayout) => `${COMMON_WGSL}
${VSM_MARKING_PARAMS_WGSL}
${vsmBindingsWgsl(0, VSM_COARSE_SPECS, layout)}
@group(0) @binding(4) var<uniform> vsmMarking:VsmMarkingParams;
${VSM_PROJECTION_DATA_READ_WGSL}
${VSM_MARK_PAGE_ADDRESS_WGSL}
${VSM_FILL_COVER_WGSL}
@compute @workgroup_size(${256}) fn vsmMarkCoarse(@builtin(global_invocation_id) dispatchThreadId:vec3u){
 // Thread k: the full maps first (ids from VSM_SINGLE_PAGE_MAP_SLOTS), then the single-page ones.
 var mapId=dispatchThreadId.x;
 if(mapId<vsm.fullMapCount){
  mapId+=VSM_SINGLE_PAGE_MAP_SLOTS;
 }else{
  mapId-=vsm.fullMapCount;
  if(mapId>=vsm.singlePageMapCount){return;}
 }
 let handle=vsmHandleFromId(mapId);
 let pd=vsmProjectionOf(handle);
 // A coarse page is asked for without the fine bit.
 let flags=VSM_PAGE_WANTED;
 if(pd.lightUnseen){
  // An unseen light's map asks for no page.
 }else if(pd.lightKind==LIGHT_KIND_DIRECTIONAL){
  if(pd.coarseLevel){
   let originShifted=pd.clipmapOrigin;
   let mapUvz=pd.shiftedToMapUv*vec4f(originShifted,1.0);
   let mapTexelPos=mapUvz.xy*f32(vsmTexelsAtLevel(0u));
   let pagePos=mapTexelPos*(1.0/f32(VSM_PAGE_TEXELS));
   // Page addresses truncate: mark the 4 around. A signed page read as unsigned: negative addresses wrap.
   let pagesAround=vec4i(vec2i(floor(pagePos-0.5)),vec2i(ceil(pagePos-0.5)));
   let o0=vsmTableEntryOf(handle,0u,bitcast<vec2u>(pagesAround.xy));
   let o1=vsmTableEntryOf(handle,0u,bitcast<vec2u>(pagesAround.xw));
   let o2=vsmTableEntryOf(handle,0u,bitcast<vec2u>(pagesAround.zy));
   let o3=vsmTableEntryOf(handle,0u,bitcast<vec2u>(pagesAround.zw));
   vsmRequestPage(o0,flags);
   vsmRequestPage(o1,flags);
   vsmRequestPage(o2,flags);
   vsmRequestPage(o3,flags);
   if(pd.useCover){
    vsmFillCover(o0);
    vsmFillCover(o1);
    vsmFillCover(o2);
    vsmFillCover(o3);
   }
  }
 }else if(vsmMarking.coarseLocal!=0u||handle.isSinglePage){
  // A single-page map, or a local map under coarse marking, asks for its last mip's page.
  let entryCell=vsmTableEntryOf(handle,VSM_MIPS-1u,vec2u(0u,0u));
  vsmRequestPage(entryCell,flags);
  if(pd.useCover){vsmFillCover(entryCell);}
 }
}
`

// ---- Page marking from pixels ----------------------------------------------------------------

/** Group 0 of the pixel pass: the VSM tables it reads and marks. */
export const VSM_PIXELS_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 1 },
  { resource: 'pageRequests', binding: 2, access: 'read_write' },
  { resource: 'receiverCover', binding: 3, access: 'atomic' },
]

/**
 * The page marking and the projection helpers it calls, against the primary
 * view in `vsmMarking`. Needs `vsmProjectionOf`, `vsmPageRequestsStore`,
 * `vsmReceiverCoverOr`.
 */
const VSM_PAGE_MARKING_WGSL = /* wgsl */ `
/** The biased clipmap level of a position, against the marking view's origin shift. */
fn vsmMarkedLevel(base:VsmProjectionData,shiftedPosition:vec3f)->i32{
 let biasedLevel=vsmLevelOfDistanceSq(vsmDistanceSqToOrigin(base,shiftedPosition,vsmMarking.originShiftHigh,vsmMarking.originShiftLow))
  +base.levelBias+vsm.pressureBias;
 return i32(floor(biasedLevel));
}
/** The mip level a local light's page is marked at. */
fn vsmMarkLocalMipLevel(pd:VsmProjectionData,shiftedPosition:vec3f,sceneDepth:f32)->u32{
 let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmMarking.originShiftHigh,vsmMarking.originShiftLow);
 let pointInMap=shiftedPosition+toMapShift;
 let footprint=vsmLocalPixelFootprint(pd,pointInMap,sceneDepth,vsmMarking.viewToClip,vec2f(vsmMarking.viewSize));
 return vsmLocalMipLevel(footprint,pd.levelBias,vsm.pressureBias,0.0);
}
/** Marks the receiver cover: one bit of the page's 8x8 cells, atomic OR. */
fn vsmMarkCover(entryCell:VsmTableCell,mapTexelAt:vec2u){
 let coverCell=(mapTexelAt>>vec2u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS))&vec2u(VSM_COVER_CELL_MASK);
 let coverQuadrant=(mapTexelAt>>vec2u(VSM_LOG2_PAGE-1u))&vec2u(1u);
 let t=entryCell.tableXY*2u+coverQuadrant;
 if(vsmCoverInBounds(t,0u)){
  _=vsmReceiverCoverOr(vsmCoverIndex(t,0u),1u<<(coverCell.y*4u+coverCell.x));
 }
}
/** Marks the page of a position. \`ortho\`, a literal at each call: a clipmap level's projection is
 *  orthographic, its w row (0, 0, 0, 1) gives w = 1 exactly for a finite point, and the divide
 *  that would return xyz as they are is left out (\`orthoW.test.ts\`). */
fn vsmMarkPage(handle:VsmHandle,mipLevel:u32,shiftedPosition:vec3f,hasMargin:bool,marginOffset:vec2f,ortho:bool){
 let pd=vsmProjectionOf(handle);
 let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmMarking.originShiftHigh,vsmMarking.originShiftLow);
 let pointInMap=shiftedPosition+toMapShift;
 var mapUvz=pd.shiftedToMapUv*vec4f(pointInMap,1.0);
 if(!ortho){mapUvz=vec4f(mapUvz.xyz/mapUvz.w,mapUvz.w);}
 // Overlap vs the shadow map space (the divided xyz against w).
 let inClip=mapUvz.w>0.0&&all(mapUvz.xyz<=vec3f(mapUvz.w))&&all(mapUvz.xyz>=vec3f(-mapUvz.w,-mapUvz.w,0.0));
 if(!inClip){return;}
 // A page marked from a pixel is fine: the fine casters draw into it.
 let flags=VSM_PAGE_WANTED|VSM_PAGE_FINE;
 let lastTexel=vsmTexelsAtLevel(mipLevel)-1u;
 let texelPos=mapUvz.xy*f32(vsmTexelsAtLevel(mipLevel));
 let mapTexelAt=clamp(vec2u(texelPos),vec2u(0u),vec2u(lastTexel));
 let pageAddress=mapTexelAt>>vec2u(VSM_LOG2_PAGE);
 let entryCell=vsmTableEntryOf(handle,mipLevel,pageAddress);
 vsmRequestPage(entryCell,flags);
 if(pd.useCover){vsmMarkCover(entryCell,mapTexelAt);}
 // A zero dilation border gives a zero dilation offset.
 if(hasMargin){
  let lastPage=lastTexel>>VSM_LOG2_PAGE;
  let pagePos=texelPos/f32(VSM_PAGE_TEXELS);
  let marginPageA=clamp(vec2u(pagePos+marginOffset),vec2u(0u),vec2u(lastPage));
  let entryCell2=vsmTableEntryOf(handle,mipLevel,marginPageA);
  if(vsmTableCellPack(entryCell2)!=vsmTableCellPack(entryCell)){vsmRequestPage(entryCell2,flags);}
  let marginPageB=clamp(vec2u(pagePos-marginOffset),vec2u(0u),vec2u(lastPage));
  let entryCell3=vsmTableEntryOf(handle,mipLevel,marginPageB);
  if(vsmTableCellPack(entryCell3)!=vsmTableCellPack(entryCell)){vsmRequestPage(entryCell3,flags);}
 }
}
/** Marks the page of a position in a sun's clipmap. The biased level is raised to the clipmap's
 *  first: a level below it marks the first anyway, and the first (0 or more) keeps the difference
 *  from overflowing where a point at the clipmap's origin gives a level of -infinity. */
fn vsmMarkPageDirectional(handle:VsmHandle,shiftedPosition:vec3f,hasMargin:bool,marginOffset:vec2f){
 let pd=vsmProjectionOf(handle);
 let mapLevel=max(pd.mapLevel,vsmMarkedLevel(pd,shiftedPosition));
 let levelIndex=mapLevel-pd.mapLevel;
 if(levelIndex<pd.levelsLeft){
  vsmMarkPage(vsmHandleOffset(pd.handle,levelIndex),0u,shiftedPosition,hasMargin,marginOffset,true);
 }
}
/** Marks the page of a position for a local light: radialNotSpot = a point light (radial, not a spot). */
fn vsmMarkPageLocal(lightShiftedPosition:vec3f,radialNotSpot:bool,handleIn:VsmHandle,shiftedPosition:vec3f,sceneDepth:f32,hasMargin:bool,marginOffset:vec2f){
 var handle=handleIn;
 if(radialNotSpot){
  let toLightSq=lightShiftedPosition-shiftedPosition;
  handle=vsmHandleOffset(handle,i32(vsmCubeFace(-toLightSq)));
 }
 let mipLevel=vsmMarkLocalMipLevel(vsmProjectionOf(handle),shiftedPosition,sceneDepth);
 vsmMarkPage(handle,mipLevel,shiftedPosition,hasMargin,marginOffset,false);
}
`

/**
 * The page marks from pixels, entry `vsmMarkPagesFromPixels`, 8x8, input
 * type GBuffer. Group 0: `VSM_PIXELS_SPECS`. Group 1: 0 depth, 1 normalRough, 2 surface flags,
 * 3 the engine's deferred `View`, 4 directLights, 5 tileLights, 6 per-light VSM id (i32, -1 none,
 * indexed like `directLights.items`: the light's VSM id), 7 directional VSM ids, 8 `VsmMarkingParams`.
 */
export const vsmPixelPageMarkingWgsl = (layout: VsmLayout) => `${COMMON_WGSL}
${VSM_MARKING_PARAMS_WGSL}
${VIEW_WGSL}
${vsmBindingsWgsl(0, VSM_PIXELS_SPECS, layout)}
@group(1) @binding(0) var depth:texture_depth_2d;
@group(1) @binding(1) var normalRough:texture_2d<f32>;
@group(1) @binding(2) var flags:texture_2d<u32>;
@group(1) @binding(3) var<uniform> view:View;
@group(1) @binding(4) var<storage,read> directLights:DirectLights;
@group(1) @binding(5) var<storage,read> tileLights:array<u32>;
@group(1) @binding(6) var<storage,read> vsmLightIds:array<i32>;
@group(1) @binding(7) var<storage,read> vsmDirectionalLightIds:array<u32>;
@group(1) @binding(8) var<uniform> vsmMarking:VsmMarkingParams;
${DIRECT_LIGHT_WGSL}
${TILE_SLICE_WGSL}
${pixelCellWgsl()}
${WORLD_AT_WGSL}
${VSM_PROJECTION_DATA_READ_WGSL}
${VSM_MARK_PAGE_ADDRESS_WGSL}
${VSM_PAGE_MARKING_WGSL}
/** The engine's light \`light\`'s position, translated, as the loop reads it. */
fn vsmLightShiftedPosition(light:DirectLight)->vec3f{
 return (light.positionRange.xyz+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
}
@compute @workgroup_size(${VSM_MARK_PIXELS_GROUP_XY},${VSM_MARK_PIXELS_GROUP_XY}) fn vsmMarkPagesFromPixels(
 @builtin(local_invocation_index) groupIndex:u32,
 @builtin(global_invocation_id) dispatchThreadId:vec3u){
 let stridedPixel=dispatchThreadId.xy*vsmMarking.pixelStride;
 let pixelPos=vsmMarking.viewRectMin+stridedPixel;
 if(any(pixelPos>=vsmMarking.viewRectMin+vsmMarking.viewSize)){return;}
 let coord=vec2i(pixelPos);
 // The input is the deferred buffers. Valid = lit: no surface (0/1) and unlit / as-is surfaces are
 // skipped before their depth and normal are read; backface culling is off for subsurface surfaces.
 let surfaceFlags=textureLoad(flags,coord,0).r;
 let surfaceModel=surfaceFlags&${SURFACE_MODEL_MASK}u;
 if(surfaceModel<=1u||surfaceModel==${AS_IS_FLAG}u){return;}
 let deviceZ=textureLoad(depth,coord,0);
 let worldNormal=normalize(textureLoad(normalRough,coord,0).xyz);
 let backfaceCull=vsmMarking.skipBackFaces!=0u&&(surfaceFlags&${SUBSURFACE_FLAG}u)==0u;
 // Position: the fragment position = pixel + 0.5, shifted from the view's own reconstruction.
 let sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmMarking.depthFromDeviceZ);
 let svPosition=vec2f(pixelPos)+0.5;
 let world=worldAt(svPosition,deviceZ);
 let shiftedPosition=(world+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
 // Dither pattern for page dilation: one diagonal, by the group index.
 let marginSide=vec2f(select(-1.0,1.0,(groupIndex&1u)!=0u),select(-1.0,1.0,(groupIndex&2u)!=0u));
 // Directional lights.
 {
  let hasMargin=vsmMarking.sunMarginPages>0.0;
  let marginOffset=vsmMarking.sunMarginPages*marginSide;
  for(var index=0u;index<vsmMarking.sunMapCount;index++){
   let handle=vsmHandleFromId(vsmDirectionalLightIds[index]);
   let pd=vsmProjectionOf(handle);
   var facesSun=true;
   if(backfaceCull&&vsmFacesAwayFromSun(worldNormal,pd.lightDirection,pd.emitterSize)){facesSun=false;}
   if(facesSun){vsmMarkPageDirectional(handle,shiftedPosition,hasMargin,marginOffset);}
  }
 }
 // Local lights, over the engine's light grid cell: lights without a VSM, single-page "distant"
 // lights and directional lights are skipped in the walk.
 {
  let hasMargin=vsmMarking.localMarginPages>0.0;
  let marginOffset=vsmMarking.localMarginPages*marginSide;
  let localPosition=pixelPos-vsmMarking.viewRectMin;
  let cell=pixelCell(vec2f(localPosition)+0.5,deviceZ);
  if(cell==TILE_NO_SLICE){return;}
  let slice=cellSlice(cell);
  for(var index=0u;index<slice.y;index++){
   var lightIndex=index;
   if(slice.x!=TILE_NO_SLICE){lightIndex=tileLights[slice.x+index];}
   let handle=vsmHandleFromId(bitcast<u32>(vsmLightIds[lightIndex]));
   if(!vsmHandleIsValid(handle)||handle.isSinglePage){continue;}
   let light=directLights.items[lightIndex];
   if(isSun(light)){continue;}
   let lightShiftedPosition=vsmLightShiftedPosition(light);
   let d=lightShiftedPosition-shiftedPosition;
   let lengthSquared=dot(d,d);
   let radius=light.positionRange.w;
   if(lengthSquared>radius*radius){continue;}
   let toLight=normalize(d);
   // The direction points back toward the light (-forward); the cone's cosine is directionCone.w, -2 off-spot.
   let lightDirection=-light.directionCone.xyz;
   if(dot(toLight,lightDirection)<light.directionCone.w){continue;}
   let rect=isRect(light);
   if(rect&&dot(toLight,lightDirection)<0.0){continue;}
   // The source radius: a point/spot's emitter radius, a rect's half width.
   let sourceRadius=select(light.shape.x,length(light.shape.xyz),rect);
   if(backfaceCull&&vsmFacesAwayFromLocal(d,worldNormal,sourceRadius)){continue;}
   let spot=abs(light.params.x-KIND_SPOT)<0.5;
   vsmMarkPageLocal(lightShiftedPosition,!spot,handle,shiftedPosition,sceneDepth,hasMargin,marginOffset);
  }
 }
}
`
