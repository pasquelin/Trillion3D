/**
 * Page marking: the WGSL of the first passes of the page marking —
 * - the page table clear with its per-page dispatch setup;
 * - the page rect bounds init;
 * - the coarse page marking;
 * - the page marks from the pixels and its marking helpers (biased clipmap level, local mip
 *   level, page address, page receiver cover, directional and local marking), the clipmap level
 *   and local footprint, and the back-face tests against directional and local lights.
 *
 * The marks are storage-buffer writes (`vsm*Store` / `vsm*Or` from the binding builder); a texel
 * out of range is skipped by an explicit bounds test.
 *
 * Pixel inputs are the engine's own: depth, normals, surface flags, the deferred `View` and
 * `worldAt`, and the light grid
 * (`pixelCell`, `cellSlice`, `tileLights`).
 * What the engine's view uniform lacks (the +z-forward view-to-clip matrix, the depth-from-device-Z
 * coefficients, the origin shift, the view rect) comes in `VsmMarkingParams` (`markingPass.ts`).
 */
import { VSM_CONSTANTS_WGSL, VSM_MAX_SINGLE_PAGE_MAPS } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_STRUCTS_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from './pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from './projection/projectionDataWgsl.ts'
import { prefilteredDeps } from './prefilteredWgsl.ts'
import { vsmLocalMipAt } from './trace/traceMapWgsl.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from './resources.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { localLightReaches } from '../../direct/lightReachWgsl.ts'
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../../direct/lightingWgsl.ts'
import { SHADOW_SLICE_WGSL } from '../../direct/shadowSlice.ts'
import { vsmSubsurfaceModel } from './subsurfaceModelWgsl.ts'
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../../../materials/surface/surfaceModelWord.ts'
import { isFirstPerson } from '../../../materials/surface/surfaceModel.ts'
import type { VsmLayout } from './layout.ts'
import type { VsmInputType } from './inputType.ts'
import { hairTilePixel } from '../../../hair/tilesWgsl.ts'
import { HAIR_TILE_ALL, HAIR_TILE_LISTS } from '../../../hair/visibilityMath.ts'
import { FLAT_INDEX_WGSL } from '../../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn, wgslVariants } from '../../../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../../../math/src/wgsl/integer.ts'
import { clipToFramebuffer, perspectiveDivide } from '../../../../../math/src/wgsl/projection.ts'
import { ATLAS_MAP_WORDS } from '../classic/atlas/atlasPlan.ts'
import { HIZ_FRONT_LAYER } from '../../../visibility/hiz/gpu/pyramidTexture.ts'

/** The level below which a sun's marks never go: none (a first-person pixel's marks are clamped to
 *  `shadowFirstPersonRequestMinLevelClamp`). */
export const NO_MIN_LEVEL = -10000

/** The group side of the page marks from pixels pass. */
export const VSM_MARK_PIXELS_GROUP_XY = 8
/** The group side of the per-page shaders. */
export const VSM_PER_PAGE_GROUP_XY = 8
/** Byte size of `VsmMarkingParams`. */
export const VSM_MARKING_PARAMS_BYTES = 240

/**
 * The marking passes' own parameters (the page marks generation, coarse marking and page rect
 * bounds scalars) and the map view.
 * Offsets: 0 viewToClip, 64 depthFromDeviceZ, 80 originShiftHigh, 92 sunMapCount,
 * 96 originShiftLow, 108 rectsToClear, 112 viewRectMin, 120 viewSize, 128 previousViewProjection,
 * 192 historySize, 200 pageDilation (the sun's, the local lights'), 208 markStride, 216
 * cullBackfacing, 220 firstPersonBias (a negative one marks nothing for the pixels of first-person objects),
 * 224 firstPersonLevelClamp, 228 frontSameImage (1: the front layer is the image's own), 232 singleMaps (the maps of one
 * page claimed, at the ids from 0). historySize,
 * frontSameImage and the matrix before them are read by the pass that marks from the translucent
 * front layer alone (`vsmPixelPageMarkingWgsl` `front`). The rest the marking never varies is
 * constants of the shader (`constants.ts`).
 */
export const VSM_MARKING_PARAMS_WGSL = wgslBlock(
  'VSM_MARKING_PARAMS_WGSL',
  [],
  `
struct VsmMarkingParams{
 viewToClip:mat4x4f,
 depthFromDeviceZ:vec4f,
 originShiftHigh:vec3f,
 sunMapCount:u32,
 originShiftLow:vec3f,
 rectsToClear:u32,
 viewRectMin:vec2u,
 viewSize:vec2u,
 previousViewProjection:mat4x4f,
 historySize:vec2f,
 pageDilation:vec2f,
 markStride:vec2u,
 cullBackfacing:u32,
 firstPersonBias:f32,
 firstPersonLevelClamp:i32,
 frontSameImage:u32,
 singleMaps:u32,
}
`,
)

// ---- Page table reset ------------------------------------------------------------------------

/** What a page table clear variant clears: one of the 2D tables, its mip count and sample stride. */
export type VsmClearTarget = 'pageRequests' | 'pageTable' | 'pageMarks' | 'receiverCover'

/** The maps a clear walks: every map, or the suns' alone. */
type VsmClearWalk = 'all' | 'directionalOnly'
/** The marking's clears, in the order they run: the page requests, the receiver cover, the page table
 *  and its flags. */
export type VsmClearStep = 'requests' | 'receiver' | 'tables'

/** One clear of the marking: the maps it walks and the tables it clears there. */
export interface VsmClearPlan {
  walk: VsmClearWalk
  targets: VsmClearTarget[]
}

/** The tables each clear of the marking clears, and the maps it walks: the request flags of every map; a
 *  receiver cover, by the maps it holds (`coverMode`: every map's, or the suns' alone, none for no
 *  cover); the page table and its flags of every map, in one walk. */
export function vsmMarkingClears(layout: VsmLayout): Record<VsmClearStep, VsmClearPlan> {
  return {
    requests: { walk: 'all', targets: ['pageRequests'] },
    receiver: {
      walk: layout.coverMode === 'suns' ? 'directionalOnly' : 'all',
      targets: layout.coverMode === 'none' ? [] : ['receiverCover'],
    },
    tables: { walk: 'all', targets: ['pageTable', 'pageMarks'] },
  }
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
 * The per-page dispatch setup, through the module's `vsmPerPageIds`, `vsmPerPage`
 * (VsmMapWalkParams) and `vsmProjectionData`.
 */
export const VSM_PER_PAGE_DISPATCH_WGSL = wgslBlock(
  'VSM_PER_PAGE_DISPATCH_WGSL',
  [FLAT_INDEX_WGSL, VSM_CONSTANTS_WGSL, VSM_HANDLE_WGSL],
  `
/** \`gridWidth\`: a grouped bin's walk side and row pitch; 0 for a thread-per-id bin, which ranks itself (\`flatIndex\`). */
struct VsmMapWalkParams{idStart:u32,idCount:u32,gridWidth:u32,threadPerId:u32,}
struct VsmMapWalk{
 valid:bool,
 handle:VsmHandle,
 walkStart:vec2u,
 walkStep:u32,
 firstMip:u32,
 endMip:u32,
}
fn vsmMapWalkOf(dispatchThreadId:vec3u,numWorkgroups:vec3u)->VsmMapWalk{
 var s:VsmMapWalk;
 s.valid=false;
 s.handle=vsmHandleInvalid();
 if(vsmPerPage.threadPerId!=0u){
  s.walkStart=vec2u(0u);
  s.walkStep=1u;
  let threadIndex=flatIndex(dispatchThreadId,numWorkgroups,${VSM_PER_PAGE_GROUP_XY}u);
  if(threadIndex>=vsmPerPage.idCount){return s;}
  s.handle=vsmHandleFromId(vsmPerPageIds[vsmPerPage.idStart+threadIndex]);
 }else{
  // A map's \`gridWidth\` threads a side, its rank \`z\` in a row of maps, rows of maps up \`y\`
  // past one dimension's groups (\`vsmDispatchPerPageBin\`); a map past the bin's leaves.
  let mapIndex=dispatchThreadId.y/vsmPerPage.gridWidth*numWorkgroups.z+dispatchThreadId.z;
  if(mapIndex>=vsmPerPage.idCount){return s;}
  s.handle=vsmHandleFromId(vsmPerPageIds[vsmPerPage.idStart+mapIndex]);
  s.walkStart=vec2u(dispatchThreadId.x,dispatchThreadId.y%vsmPerPage.gridWidth);
  s.walkStep=vsmPerPage.gridWidth;
 }
 s.valid=true;
 let pd=vsmProjectionData[s.handle.id];
 s.firstMip=pd.finestMip;
 s.endMip=select(VSM_MIPS,1u,pd.lightKind==LIGHT_KIND_DIRECTIONAL);
 return s;
}
fn vsmPagesAcross(mipLevel:u32)->u32{return VSM_LEVEL0_PAGES>>mipLevel;}
`,
)

/** The declarations and the walk's lines that clear `target`, the `n`-th of a clear. */
function vsmClearTable(target: VsmClearTarget, n: number, layout: VsmLayout) {
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
}

/**
 * The clears of several tables in one walk of each map's pages (`targets`, each its own `numMips`
 * and `sampleStride`): every table a texel of a page clears is cleared there, as one kernel a table
 * cleared it; the clear value is 0, the only value the marking pass clears with. Entry
 * `vsmClearPageTables`, 8x8; binding 4 + n is the n-th target.
 */
export function vsmResetPageTableWgsl(targets: readonly VsmClearTarget[], layout: VsmLayout) {
  const tables = targets.map((target, n) => vsmClearTable(target, n, layout))
  return wgslProgram(
    `@group(0) @binding(3) var<uniform> vsmPerPage:VsmMapWalkParams;
const VSM_CLEAR_VALUE:u32=0u;
${tables.map((t) => t.declarations).join('\n')}
@compute @workgroup_size(${VSM_PER_PAGE_GROUP_XY},${VSM_PER_PAGE_GROUP_XY}) fn vsmClearPageTables(@builtin(global_invocation_id) dispatchThreadId:vec3u,@builtin(num_workgroups) numWorkgroups:vec3u){
 let setup=vsmMapWalkOf(dispatchThreadId,numWorkgroups);
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
`,
    [
      VSM_UNIFORMS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      vsmBindingsWgsl(0, VSM_CLEAR_SPECS, layout),
      VSM_PER_PAGE_DISPATCH_WGSL,
    ],
  )
}

// ---- Raster marks clear ----------------------------------------------------------------------

export const VSM_CLEAR_RASTER_MARKS_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'rasterMarks', binding: 0, access: 'read_write' },
]

/** The raster marks (the pages' dirty flags and the deferred invalidations' count) cleared, entry
 *  `vsmClearRasterMarks`, a thread a word of the buffer, 256 a group. */
export const vsmClearRasterMarksWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `@compute @workgroup_size(${256}) fn vsmClearRasterMarks(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(id,n,256u);
 if(index<arrayLength(&vsmRasterMarks)){vsmRasterMarks[index]=0u;}
}
`,
    [vsmBindingsWgsl(0, VSM_CLEAR_RASTER_MARKS_SPECS, layout), FLAT_INDEX_WGSL],
  )

// ---- Page rect init --------------------------------------------------------------------------

export const VSM_INIT_RECT_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'staleRects', binding: 1, access: 'read_write' },
  { resource: 'mappedRects', binding: 2, access: 'read_write' },
]

/** The id of the claimed map `k`, the maps of one page being the first `singleMaps` and the full maps those past them, from the end of the range reserved for the first (`VSM_MAX_SINGLE_PAGE_MAPS`). */
const VSM_CLAIMED_MAP_ID_WGSL = wgslFn(
  'vsmClaimedMapId',
  [],
  `fn vsmClaimedMapId(k:u32,singleMaps:u32)->u32{return select(${VSM_MAX_SINGLE_PAGE_MAPS}u+k-singleMaps,k,k<singleMaps);}`,
)

/** The page rect bounds init, entry `vsmInitPageRects`, 256 threads. Binding 4: params. */
export const vsmPageRectInitWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `@group(0) @binding(4) var<uniform> vsmMarking:VsmMarkingParams;
@compute @workgroup_size(${256}) fn vsmInitPageRects(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=flatIndex(id,n,256u);
 if(thread<vsmMarking.rectsToClear){
  // Thread t: mip t % VSM_MIPS of the claimed map t / VSM_MIPS.
  let index=vsmClaimedMapId(thread/VSM_MIPS,vsmMarking.singleMaps)*VSM_MIPS+thread%VSM_MIPS;
  let empty=vec4u(VSM_LEVEL0_PAGES,VSM_LEVEL0_PAGES,0u,0u);
  vsmStaleRects[2u*index]=empty;
  vsmStaleRects[2u*index+1u]=empty;
  vsmMappedRects[index]=empty;
 }
}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_MARKING_PARAMS_WGSL,
      vsmBindingsWgsl(0, VSM_INIT_RECT_SPECS, layout),
      FLAT_INDEX_WGSL,
      VSM_CLAIMED_MAP_ID_WGSL,
    ],
  )

// ---- Marking helpers ----------------------------------------

/**
 * Requests a page, and fills its whole receiver cover, through the module's
 * `vsmPageRequestsStore` and, for the full-page mask, `vsmReceiverCoverStore`.
 */
const VSM_MARK_PAGE_ADDRESS_WGSL = wgslBlock(
  'VSM_MARK_PAGE_ADDRESS_WGSL',
  [VSM_PAGE_ADDRESS_WGSL],
  `
fn vsmRequestPage(entryCell:VsmTableCell,flags:u32){
 let t=entryCell.tableXY;
 if(all(t<vsm.pageTableSize)){vsmPageRequestsStore(vsmTableIndex(t),flags);}
}
`,
)
const VSM_FILL_COVER_WGSL = wgslBlock(
  'VSM_FILL_COVER_WGSL',
  [VSM_PAGE_ADDRESS_WGSL],
  `
fn vsmCoverStore0(t:vec2u,v:u32){if(vsmCoverInBounds(t,0u)){vsmReceiverCoverStore(vsmCoverIndex(t,0u),v);}}
fn vsmFillCover(entryCell:VsmTableCell){
 let a=entryCell.tableXY*2u;
 vsmCoverStore0(a+vec2u(0u,0u),0xFFFFu);
 vsmCoverStore0(a+vec2u(1u,0u),0xFFFFu);
 vsmCoverStore0(a+vec2u(0u,1u),0xFFFFu);
 vsmCoverStore0(a+vec2u(1u,1u),0xFFFFu);
}
`,
)

// ---- Coarse marking --------------------------------------------------------------------------

export const VSM_COARSE_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 1 },
  { resource: 'pageRequests', binding: 2, access: 'read_write' },
  { resource: 'receiverCover', binding: 3, access: 'read_write' },
]

/** The flags a page marked from the view carries: wanted, fine unless `fine` is false (a coarse page),
 *  and with the prefiltered distant shadow the primary request (`VSM_PAGE_PRIMARY`). */
export const markedPageFlagsText = (prefiltered: boolean, fine = true) =>
  `VSM_PAGE_WANTED${fine ? '|VSM_PAGE_FINE' : ''}${prefiltered ? '|VSM_PAGE_PRIMARY' : ''}`

/** The coarse marking's binding and the head of its kernel: the claimed map and the flags it asks pages with. */
const coarseHeadText = (
  layout: VsmLayout,
) => `@group(0) @binding(4) var<uniform> vsmMarking:VsmMarkingParams;
@compute @workgroup_size(${256}) fn vsmMarkCoarse(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 // Thread k: claimed map k.
 let thread=flatIndex(id,n,256u);
 let mapId=vsmClaimedMapId(thread,vsmMarking.singleMaps);
 if(mapId>=vsm.mapCount){return;}
 let handle=vsmHandleFromId(mapId);
 let pd=vsmProjectionOf(handle);
 // A coarse page is asked for without the fine bit.
 let flags=${markedPageFlagsText(layout.prefilteredDistant, false)};`

/** The coarse pages a map asks for: a sun's four around the clipmap origin, a local light's last mip. */
const COARSE_PAGES_TEXT = ` if(pd.lightUnseen){
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
 }else if(pd.coarseLevel||pd.distant){
  // A local map (a far receiver always finds one) asks for its last mip's page, unless the view
  // turns local coarse pages off (\`shadowMarkCoarsePagesLocal\` 0, no coarse flag in its record):
  // a distant light (one page, its last mip) always does.
  let entryCell=vsmTableEntryOf(handle,VSM_MIPS-1u,vec2u(0u,0u));
  vsmRequestPage(entryCell,flags);
  if(pd.useCover){vsmFillCover(entryCell);}
 }
}
`

/** The coarse page marking, entry `vsmMarkCoarse`, 256 threads. Binding 4: params. */
export const vsmCoarseMarkingWgsl = (layout: VsmLayout) =>
  wgslProgram(`${coarseHeadText(layout)}\n${COARSE_PAGES_TEXT}`, [
    ...prefilteredDeps(layout.prefilteredDistant),
    VSM_CONSTANTS_WGSL,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_TABLE_ORIGIN_WGSL,
    VSM_MARKING_PARAMS_WGSL,
    vsmBindingsWgsl(0, VSM_COARSE_SPECS, layout),
    VSM_PROJECTION_DATA_READ_WGSL,
    VSM_MARK_PAGE_ADDRESS_WGSL,
    VSM_FILL_COVER_WGSL,
    FLAT_INDEX_WGSL,
    VSM_CLAIMED_MAP_ID_WGSL,
  ])

// ---- Dense marking (the classic shadow maps) ----------------------------------------------------

/** The words of one dense entry (`vsmMarkDense`): the sphere's centre and radius, the map, the mip and the kind. */
export const VSM_DENSE_ENTRY_WORDS = 8
/** The kinds of a dense entry: the pages a sphere covers in a clipmap level's map, or every page of a mip of a map. */
const VSM_DENSE_KIND = { sphere: 0, whole: 1 } as const
/** The threads that walk one entry's pages (a group of 64, this many over 64 groups across). */
export const VSM_DENSE_GROUPS_ACROSS = 16
const VSM_DENSE_THREADS = VSM_DENSE_GROUPS_ACROSS * 64

/**
 * The dense marking, entry `vsmMarkDense`, 64 threads, a row of groups an entry (`vsmDense`, group 1 binding 0): for a classic shadow map
 * (`shadowVirtualEnable` off) every page it draws is asked for whatever the view marks — the pages of a clipmap level a sphere (a cascade's bounds) covers, or
 * every page of one mip of a map (a local light's) —, as the coarse marking asks its own, with the flags of a page marked from the view. Binding 4: params.
 */
export const vsmDenseMarkingWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `struct VsmDenseEntry{centre:vec3f,radius:f32,mapId:u32,mip:u32,kind:u32,spare:u32,}
@group(1) @binding(0) var<storage,read> vsmDense:array<VsmDenseEntry>;
/** The atlas buffer: ${ATLAS_MAP_WORDS} words a map, the first four the union of the page rects its entries ask (the complement of the first page's x and y, the last page's x and y; zero where no entry asks), the rest the map's tile. */
@group(1) @binding(1) var<storage,read_write> vsmAtlasRects:array<atomic<u32>>;
@group(0) @binding(4) var<uniform> vsmMarking:VsmMarkingParams;
@compute @workgroup_size(${64}) fn vsmMarkDense(@builtin(global_invocation_id) id:vec3u){
 let entry=vsmDense[id.y];
 let handle=vsmHandleFromId(entry.mapId);
 let pd=vsmProjectionOf(handle);
 if(pd.lightUnseen){return;}
 let flags=${markedPageFlagsText(layout.prefilteredDistant)};
 var origin=vec2i(0);
 var size=vec2i(1);
 var mip=entry.mip;
 if(entry.kind==${VSM_DENSE_KIND.whole}u){
  size=vec2i(i32(max(1u,vsmTexelsAtLevel(mip)>>VSM_LOG2_PAGE)));
 }else{
  // The pages a sphere covers in the level's map: its centre's UV and the share of the map its radius spans along each axis.
  mip=0u;
  let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmMarking.originShiftHigh,vsmMarking.originShiftLow);
  let m=pd.shiftedToMapUv;
  let uv=(m*vec4f(entry.centre+toMapShift,1.0)).xy;
  let extent=entry.radius*vec2f(length(vec3f(m[0][0],m[1][0],m[2][0])),length(vec3f(m[0][1],m[1][1],m[2][1])));
  let pages=f32(VSM_LEVEL0_PAGES);
  let low=vec2i(floor((uv-extent)*pages));
  let high=vec2i(floor((uv+extent)*pages));
  origin=max(low,vec2i(0));
  size=min(high,vec2i(i32(VSM_LEVEL0_PAGES)-1))-origin+vec2i(1);
 }
 if(any(size<=vec2i(0))){return;}
 if(id.x==0u){
  let rect=entry.mapId*${ATLAS_MAP_WORDS}u;
  let last=origin+size-vec2i(1);
  atomicMax(&vsmAtlasRects[rect],~u32(origin.x));
  atomicMax(&vsmAtlasRects[rect+1u],~u32(origin.y));
  atomicMax(&vsmAtlasRects[rect+2u],u32(last.x));
  atomicMax(&vsmAtlasRects[rect+3u],u32(last.y));
 }
 let total=u32(size.x*size.y);
 for(var k=id.x;k<total;k+=${VSM_DENSE_THREADS}u){
  let cell=vsmTableEntryOf(handle,mip,vec2u(origin)+vec2u(k%u32(size.x),k/u32(size.x)));
  vsmRequestPage(cell,flags);
  if(pd.useCover){vsmFillCover(cell);}
 }
}
`,
    [
      ...prefilteredDeps(layout.prefilteredDistant),
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_MARKING_PARAMS_WGSL,
      vsmBindingsWgsl(0, VSM_COARSE_SPECS, layout),
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_MARK_PAGE_ADDRESS_WGSL,
      VSM_FILL_COVER_WGSL,
    ],
  )

// ---- Page marking from pixels ----------------------------------------------------------------

/** Group 0 of the pixel pass: the VSM tables it reads and marks. */
export const VSM_PIXELS_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 1 },
  { resource: 'pageRequests', binding: 2, access: 'read_write' },
  { resource: 'receiverCover', binding: 3, access: 'atomic' },
]

/** `vsmMarkedLevel`: the first map's bias for every level of a clipmap or, `throttled`, the bias of
 *  the map the level falls in (`vsmClipmapLevelBias`). */
const markedLevelText = (throttled: boolean) => {
  const firstBias = throttled ? '' : 'base.levelBias+'
  const mapBias = throttled
    ? `
 biasedLevel+=vsmClipmapLevelBias(base,biasedLevel);`
    : ''
  return `/** The biased clipmap level of a position, against the marking view's origin shift. */
fn vsmMarkedLevel(base:VsmProjectionData,shiftedPosition:vec3f,extraBias:f32)->i32{
 ${throttled ? 'var' : 'let'} biasedLevel=vsmLevelOfDistanceSq(vsmDistanceSqToOrigin(base,shiftedPosition,vsmMarking.originShiftHigh,vsmMarking.originShiftLow))
  +${firstBias}vsm.pressureBias+extraBias;${mapBias}
 return i32(floor(biasedLevel));
}`
}

/** The marking's functions past `vsmMarkedLevel`, the one text of the plain and the throttled block. */
/** The mip level a local light's page is marked at, and the receiver cover's mark. */
const markingLevelText = `
/** The mip level a local light's page is marked at. */
fn vsmMarkLocalMipLevel(pd:VsmProjectionData,shiftedPosition:vec3f,sceneDepth:f32,extraBias:f32)->u32{
 let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmMarking.originShiftHigh,vsmMarking.originShiftLow);
 return vsmLocalMipAt(pd,shiftedPosition+toMapShift,sceneDepth,vsmMarking.viewToClip,vec2f(vsmMarking.viewSize),extraBias);
}
/** Marks the receiver cover: one bit of the page's 8x8 cells, atomic OR. */
fn vsmMarkCover(entryCell:VsmTableCell,mapTexelAt:vec2u){
 let coverCell=(mapTexelAt>>vec2u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS))&vec2u(VSM_COVER_CELL_MASK);
 let coverQuadrant=(mapTexelAt>>vec2u(VSM_LOG2_PAGE-1u))&vec2u(1u);
 let t=entryCell.tableXY*2u+coverQuadrant;
 if(vsmCoverInBounds(t,0u)){
  _=vsmReceiverCoverOr(vsmCoverIndex(t,0u),1u<<(coverCell.y*4u+coverCell.x));
 }
}`

/** The mark of the page of a position. */
const markingPageText = (
  prefiltered: boolean,
) => `/** Marks the page of a position. \`ortho\`, a literal at each call: a clipmap level's projection is
 *  orthographic, its w row (0, 0, 0, 1) gives w = 1 exactly for a finite point, and the divide
 *  that would return xyz as they are is left out (\`orthoW.test.ts\`). */
fn vsmMarkPage(handle:VsmHandle,mipLevel:u32,shiftedPosition:vec3f,hasMargin:bool,marginOffset:vec2f,ortho:bool){
 let pd=vsmProjectionOf(handle);
 let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmMarking.originShiftHigh,vsmMarking.originShiftLow);
 let pointInMap=shiftedPosition+toMapShift;
 var mapUvz=pd.shiftedToMapUv*vec4f(pointInMap,1.0);
 if(!ortho){mapUvz=vec4f(perspectiveDivide(mapUvz),mapUvz.w);}
 // Overlap vs the shadow map space (the divided xyz against w).
 let inClip=mapUvz.w>0.0&&all(mapUvz.xyz<=vec3f(mapUvz.w))&&all(mapUvz.xyz>=vec3f(-mapUvz.w,-mapUvz.w,0.0));
 if(!inClip){return;}
 // A page marked from a pixel is fine: the fine casters draw into it.
 let flags=${markedPageFlagsText(prefiltered)};
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
}`

/** The mark of a page in a sun's clipmap and for a local light. */
const markingLightsText = `/** Marks the page of a position in a sun's clipmap, \`extraBias\` levels beyond the map's own bias and
 *  no level below \`minLevel\`. The biased level is raised to the clipmap's
 *  first: a level below it marks the first anyway, and the first (0 or more) keeps the difference
 *  from overflowing where a point at the clipmap's origin gives a level of -infinity. */
fn vsmMarkPageDirectional(handle:VsmHandle,shiftedPosition:vec3f,hasMargin:bool,marginOffset:vec2f,extraBias:f32,minLevel:i32){
 let pd=vsmProjectionOf(handle);
 let mapLevel=max(pd.mapLevel,max(minLevel,vsmMarkedLevel(pd,shiftedPosition,extraBias)));
 let levelIndex=mapLevel-pd.mapLevel;
 if(levelIndex<pd.levelsLeft){
  vsmMarkPage(vsmHandleOffset(pd.handle,levelIndex),0u,shiftedPosition,hasMargin,marginOffset,true);
 }
}
/** Marks the page of a position for a local light: radialNotSpot = a point light (radial, not a spot). */
fn vsmMarkPageLocal(lightShiftedPosition:vec3f,radialNotSpot:bool,handleIn:VsmHandle,shiftedPosition:vec3f,sceneDepth:f32,hasMargin:bool,marginOffset:vec2f,extraBias:f32){
 var handle=handleIn;
 if(radialNotSpot){
  let toLightSq=lightShiftedPosition-shiftedPosition;
  handle=vsmHandleOffset(handle,i32(vsmCubeFace(-toLightSq)));
 }
 let mipLevel=vsmMarkLocalMipLevel(vsmProjectionOf(handle),shiftedPosition,sceneDepth,extraBias);
 vsmMarkPage(handle,mipLevel,shiftedPosition,hasMargin,marginOffset,false);
}
`

const markingHelpersText = (prefiltered: boolean) =>
  `${markingLevelText}\n${markingPageText(prefiltered)}\n${markingLightsText}`

/**
 * The page marking and the projection helpers it calls, against the primary
 * view in `vsmMarking`, through the module's `vsmPageRequestsStore` and `vsmReceiverCoverOr`.
 */
const pageMarkingBlock = (throttled: boolean) =>
  wgslVariants((prefiltered) =>
    wgslBlock(
      `VSM_PAGE_MARKING${throttled ? '_THROTTLED' : ''}${prefiltered ? '_PREFILTERED' : ''}_WGSL`,
      [
        ...prefilteredDeps(prefiltered),
        VSM_CONSTANTS_WGSL,
        perspectiveDivide,
        VSM_HANDLE_WGSL,
        VSM_PAGE_ADDRESS_WGSL,
        VSM_TABLE_ORIGIN_WGSL,
        VSM_STRUCTS_WGSL,
        VSM_PROJECTION_DATA_WGSL,
        VSM_PROJECTION_DATA_READ_WGSL,
        vsmLocalMipAt,
        VSM_MARK_PAGE_ADDRESS_WGSL,
      ],
      `
${markedLevelText(throttled)}${markingHelpersText(prefiltered)}`,
    ),
  )

const VSM_PAGE_MARKING_WGSL = pageMarkingBlock(false)

/** The page marking when the compute throttle is on (`markedLevelText`). */
const VSM_PAGE_MARKING_THROTTLED_WGSL = pageMarkingBlock(true)

/** The page marking block of a program, throttled or not, with the prefiltered distant shadow or
 *  without. */
export const vsmPageMarkingBlock = (throttled: boolean, prefiltered = false) =>
  (throttled ? VSM_PAGE_MARKING_THROTTLED_WGSL : VSM_PAGE_MARKING_WGSL)(prefiltered)

/** The binding of the translucent front layer's depth in group 1 of the pass that marks from it. */
export const VSM_FRONT_DEPTH_BINDING = 9
/** The binding of the water's depth in group 1 of the pass that marks the water's surface. */
export const VSM_WATER_DEPTH_BINDING = 10

/** The front layer's depth, the Hi-Z's level 0 with its two layers (`HIZ_FRONT_LAYER`). */
const FRONT_DEPTH_WGSL = `@group(1) @binding(${VSM_FRONT_DEPTH_BINDING}) var frontDepth:texture_2d_array<f32>;`
/** The scene's depth with the water drawn into it (`WaterTargets.waterDepth`). */
const WATER_DEPTH_WGSL = `@group(1) @binding(${VSM_WATER_DEPTH_BINDING}) var waterDepth:texture_depth_2d;`

/** Marks the page of a position, translated, in every sun's clipmap: the pixel's page dilation, no
 *  extra bias, no minimum level. */
const MARK_SUNS_WGSL = `
fn vsmMarkSunsAt(position:vec3f,marginSide:vec2f){
 let hasMargin=vsmMarking.pageDilation.x>0.0;
 let marginOffset=vsmMarking.pageDilation.x*marginSide;
 for(var index=0u;index<vsmMarking.sunMapCount;index++){
  vsmMarkPageDirectional(vsmHandleFromId(vsmDirectionalLightIds[index]),position,hasMargin,marginOffset,0.0,${NO_MIN_LEVEL});
 }
}`

/**
 * The marks of the nearest translucent surface in front of the place a pixel stands in: the layer's
 * depth there (zero for no translucent surface), and the position that depth has at the pixel's own
 * place, marked in every sun's clipmap. The layer is the image's own where the front pass was drawn
 * before the marking (`frontSameImage`: the pixel's own texel); else the image before's
 * (`historySize` its drawn size): the pixel's position, reprojected by the camera of that image
 * into the layer it drew; a point behind that camera or out of the layer has none.
 */
const FRONT_MARKING_WGSL = `
fn vsmMarkTranslucent(svPosition:vec2f,shiftedPosition:vec3f,marginSide:vec2f){
 var texel=vec2i(svPosition);
 if(vsmMarking.frontSameImage==0u){
  let previous=vsmMarking.previousViewProjection*vec4f(shiftedPosition,1.0);
  if(!(previous.w>0.0)){return;}
  let there=clipToFramebuffer(previous,vsmMarking.historySize).xy;
  if(any(there<vec2f(0.5))||any(there>vsmMarking.historySize-0.5)){return;}
  texel=vec2i(there);
 }
 let frontZ=textureLoad(frontDepth,texel,${HIZ_FRONT_LAYER},0).r;
 if(!(frontZ>0.0)){return;}
 vsmMarkSunsAt((worldAt(svPosition,frontZ)+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow,marginSide);
}`

/**
 * The marks of the water's surface: where the water drew over the pixel, its depth there differs
 * from the scene's, and the position that depth has is marked in every sun's clipmap.
 */
const WATER_MARKING_WGSL = `
fn vsmMarkWater(coord:vec2i,svPosition:vec2f,deviceZ:f32,marginSide:vec2f){
 let waterZ=textureLoad(waterDepth,coord,0);
 if(waterZ==deviceZ){return;}
 vsmMarkSunsAt((worldAt(svPosition,waterZ)+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow,marginSide);
}`

/** The pass's calls of them, before a pixel that is not lit leaves: it marks the surfaces in front
 *  of it all the same. */
const marksBeforeLit = (front: boolean, water: boolean) =>
  `${front ? ' vsmMarkTranslucent(svPosition,shiftedPosition,marginSide);\n' : ''}${
    water ? ' vsmMarkWater(coord,svPosition,deviceZ,marginSide);\n' : ''
  } if(!lit){return;}
`

/** The surfaces' bindings of the pixel pass's group 1, past the depth: the normals and the flags. */
const SURFACE_BINDINGS_WGSL = `@group(1) @binding(1) var normalRough:texture_2d<f32>;
@group(1) @binding(2) var flags:texture_2d<u32>;`

/** The bindings of the strands' pixel pass in group 1 beside the lights', the depth of the nearest
 *  strand at 0 (`vsmPixelPageMarkingWgsl`), the tiles' counts and list after the parameters. */
export const VSM_STRANDS_MARKING_BINDING = { hairDepth: 0, counts: 9, tiles: 10 } as const
const STRANDS_BINDINGS_WGSL = `@group(1) @binding(${VSM_STRANDS_MARKING_BINDING.counts}) var<uniform> hairTileCounts:vec4u;
@group(1) @binding(${VSM_STRANDS_MARKING_BINDING.tiles}) var<storage,read> hairTiles:array<u32>;`
if (HAIR_TILE_LISTS > 4 || HAIR_TILE_ALL !== 0)
  throw new Error(
    'the strands’ marking reads the tiles’ counts as one vec4u, the list of all of them from 0',
  )

/** The surfaces' pixel of a lane: a group a tile of the strided view, the deferred buffers read. */
const surfacePixelWgsl = (front: boolean, water: boolean) => `
 // A group a tile of the strided view, row after row of \`tilesX\`: its rank read back as the tile.
 let side=${VSM_MARK_PIXELS_GROUP_XY}u;
 let tilesX=ceilDiv(ceilDiv(vsmMarking.viewSize.x,vsmMarking.markStride.x),side);
 let tile=flatIndex(group,n,1u);
 let stridedPixel=(vec2u(tile%tilesX,tile/tilesX)*side+lane.xy)*vsmMarking.markStride;
 let pixelPos=vsmMarking.viewRectMin+stridedPixel;
 if(any(pixelPos>=vsmMarking.viewRectMin+vsmMarking.viewSize)){return;}
 let coord=vec2i(pixelPos);
 // The input is the deferred buffers: the depth, the normal and the flags are read, then the pixel is
 // valid when lit: no surface (0/1) and unlit / as-is surfaces are left out, as the reference's deferred
 // format leaves its unlit pixels out (the sky dome among them); backface culling is off for
 // subsurface surfaces.
 let surfaceFlags=textureLoad(flags,coord,0).r;
 let surfaceModel=surfaceFlags&${SURFACE_MODEL_MASK}u;
 let deviceZ=textureLoad(depth,coord,0);
 let worldNormal=normalize(textureLoad(normalRough,coord,0).xyz);
 ${
   front || water
     ? `let lit=surfaceModel>1u&&surfaceModel!=${AS_IS_FLAG}u;`
     : `if(surfaceModel<=1u||surfaceModel==${AS_IS_FLAG}u){return;}`
 }`

/** The strands' pixel of a lane: a group a tile of the list of all the tiles with strands, a lane a
 *  pixel of it, the pixels the stride picks (the view's pixels at whole multiples of it, wherever their
 *  tile lies) at the depth of the nearest strand; a pixel no strand holds (0) is not valid. */
const STRANDS_PIXEL_WGSL = `
 // A group a tile of the list of all the tiles with strands; its lanes the tile's pixels on the stride.
 let rank=flatIndex(group,n,1u);
 if(rank>=hairTileCounts[${HAIR_TILE_ALL}]){return;}
 let tile=hairTiles[rank];
 let local=hairTilePixel(tile,lane.xy);
 if(any(local>=vsmMarking.viewSize)){return;}
 if(any(local%vsmMarking.markStride!=vec2u(0u))){return;}
 let pixelPos=vsmMarking.viewRectMin+local;
 let coord=vec2i(pixelPos);
 // The input is the depth of the nearest strand of the pixel's samples: one where a strand is.
 let deviceZ=textureLoad(hairDepth,coord,0).x;
 if(!(deviceZ>0.0)){return;}`

const pixelMarkingHead = (
  front: boolean,
  water: boolean,
  strands: boolean,
) => /* wgsl */ `${strands ? STRANDS_BINDINGS_WGSL : SURFACE_BINDINGS_WGSL}
@group(1) @binding(3) var<uniform> view:View;
@group(1) @binding(4) var<storage,read> directLights:DirectLights;
@group(1) @binding(5) var<storage,read> tileLights:array<u32>;
@group(1) @binding(6) var<storage,read> vsmLightIds:array<i32>;
@group(1) @binding(7) var<storage,read> vsmDirectionalLightIds:array<u32>;
@group(1) @binding(8) var<uniform> vsmMarking:VsmMarkingParams;
${front ? FRONT_DEPTH_WGSL : ''}
${water ? WATER_DEPTH_WGSL : ''}
/** The engine's light \`light\`'s position, translated, as the loop reads it. */
fn vsmLightShiftedPosition(light:DirectLight)->vec3f{
 return (light.positionRange.xyz+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
}
${front || water ? MARK_SUNS_WGSL : ''}
${front ? FRONT_MARKING_WGSL : ''}
${water ? WATER_MARKING_WGSL : ''}
@compute @workgroup_size(${VSM_MARK_PIXELS_GROUP_XY},${VSM_MARK_PIXELS_GROUP_XY}) fn vsmMarkPagesFromPixels(
 @builtin(local_invocation_index) groupIndex:u32,
 @builtin(local_invocation_id) lane:vec3u,
 @builtin(workgroup_id) group:vec3u,
 @builtin(num_workgroups) n:vec3u){${strands ? STRANDS_PIXEL_WGSL : surfacePixelWgsl(front, water)}
 let sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmMarking.depthFromDeviceZ);
 // Position: the fragment position = pixel + 0.5, shifted from the view's own reconstruction.
 let svPosition=vec2f(pixelPos)+0.5;
 let world=worldAt(svPosition,deviceZ);
 let shiftedPosition=(world+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
 // Dither pattern for page dilation: one diagonal, by the group index.
 let marginSide=vec2f(select(-1.0,1.0,(groupIndex&1u)!=0u),select(-1.0,1.0,(groupIndex&2u)!=0u));`

const pixelMarkingDirectional = (front: boolean, water: boolean, strands: boolean) => /* wgsl */ `
${front || water ? marksBeforeLit(front, water) : ''}${strands ? '' : ' let backfaceCull=!vsmSubsurfaceModel(surfaceFlags)&&vsmMarking.cullBackfacing!=0u;\n'} // Where the depth of field blurs the image the maps are asked at a lower resolution.
 let localExtraBias=vsmDofResolutionBias(sceneDepth);
 // The pixels of first-person objects are not self-shadowing and very near the camera: their request is
 // coarser, and never finer than a level (\`shadowFirstPersonPixelRequestBias\`,
 // \`shadowFirstPersonRequestMinLevelClamp\`). They still receive the environment's shadow.
 let firstPersonPixel=${strands ? 'false' : 'isFirstPerson(surfaceFlags)'};
 let marksFirstPerson=vsmMarking.firstPersonBias>=0.0;
 let primaryExtraBias=localExtraBias+select(0.0,vsmMarking.firstPersonBias,firstPersonPixel);
 let primaryMinLevel=select(${NO_MIN_LEVEL},vsmMarking.firstPersonLevelClamp,firstPersonPixel);
 // Directional lights.
 {
  let hasMargin=vsmMarking.pageDilation.x>0.0;
  let marginOffset=vsmMarking.pageDilation.x*marginSide;
  for(var index=0u;index<vsmMarking.sunMapCount;index++){
   let handle=vsmHandleFromId(vsmDirectionalLightIds[index]);
   let pd=vsmProjectionOf(handle);
   var facesSun=true;
${strands ? '' : '   if(backfaceCull&&vsmFacesAwayFromSun(worldNormal,pd.lightDirection,pd.emitterSize)){facesSun=false;}\n'}   // A first-person pixel is not shadowed by a first-person clipmap, and asks none when its bias is negative.
   if(firstPersonPixel&&(pd.firstPerson||!marksFirstPerson)){facesSun=false;}
   if(facesSun){vsmMarkPageDirectional(handle,shiftedPosition,hasMargin,marginOffset,primaryExtraBias,primaryMinLevel);}
  }
 }`

const pixelMarkingLocal = (strands: boolean) => /* wgsl */ `
 // Local lights, over the shadowed lights of the engine's light grid cell (the pruned grid): the pixels
 // of first-person objects where their bias is negative walk none.
 if(!firstPersonPixel||marksFirstPerson){
  let hasMargin=vsmMarking.pageDilation.y>0.0;
  let marginOffset=vsmMarking.pageDilation.y*marginSide;
  let localPosition=pixelPos-vsmMarking.viewRectMin;
  // The pruned list of the cell (\`vsmPruneLightGrid\`, read as the engine's): the shadowed lights, those with a map of one page last; a pixel without a grid walks every light.
  let slice=cellSlice(pixelCell(vec2f(localPosition)+0.5,deviceZ));
  for(var index=0u;index<slice.y;index++){
   let lightIndex=listedLight(slice,index);
   // The simple lights follow the scene's in rank and hold no shadow map: none is marked, and a walk of every light ends at the first.
   if(lightIndex>=directLights.count){if(slice.x==TILE_NO_SLICE){break;}continue;}
   let light=directLights.items[lightIndex];
   // A distant light's page is marked by the coarse marking: those come last and end the walk.
   if(shadowSliceDistant(i32(light.params.y))){if(slice.x==TILE_NO_SLICE){continue;}break;}
   let handle=vsmHandleFromId(bitcast<u32>(vsmLightIds[lightIndex]));
   if(!vsmHandleIsValid(handle)){continue;}
   if(isSun(light)){continue;}
   let lightShiftedPosition=vsmLightShiftedPosition(light);
   let d=lightShiftedPosition-shiftedPosition;
   let rect=isRect(light);
   if(!localLightReaches(d,light.positionRange.w,light.directionCone.w,light.directionCone.xyz,rect)){continue;}
${
  strands
    ? ''
    : `   // The source radius: a point/spot's emitter radius, a rect's half width.
   let sourceRadius=select(light.shape.x,length(light.shape.xyz),rect);
   if(backfaceCull&&vsmFacesAwayFromLocal(d,worldNormal,sourceRadius)){continue;}
`
}   vsmMarkPageLocal(lightShiftedPosition,!isSpot(light),handle,shiftedPosition,sceneDepth,hasMargin,marginOffset,localExtraBias);
  }
 }
}`

/**
 * The page marks from pixels, entry `vsmMarkPagesFromPixels`, 8x8, input
 * type GBuffer. Group 0: `VSM_PIXELS_SPECS`. Group 1: 0 depth, 1 normalRough, 2 surface flags,
 * 3 the engine's deferred `View`, 4 directLights, 5 tileLights (the light grid pruned to the shadowed lights, `vsmPruneLightGrid`), 6 per-light VSM id (i32, -1 none,
 * indexed like `directLights.items`: the light's VSM id), 7 directional VSM ids, 8 `VsmMarkingParams`.
 *
 * `front`, the project switch `shadowTranslucentQuality` above 0 with a front layer in hand: the pass
 * also marks, in every sun's clipmap, the page of the nearest translucent surface that layer holds
 * over the place this pixel stands in. Binding 9 is the layer's depth, the Hi-Z's level 0
 * (`VSM_FRONT_DEPTH_BINDING`, layer `HIZ_FRONT_LAYER`, zero for none). The image before's layer
 * is reprojected by `previousViewProjection` to its `historySize` and read at the pixel's own place in
 * this image, as the temporal history is; the image's own, drawn before the marking
 * (`frontSameImage`), is read at the pixel. `water`, an image whose single-layer water drew a depth
 * before the marking: binding 10 is the scene's depth with the water drawn into it
 * (`VSM_WATER_DEPTH_BINDING`), and where it differs from the pixel's, the water's surface is marked in
 * every sun's clipmap, the suns alone. A pixel that is not lit marks those surfaces alone. Without
 * them the program has neither the binding nor the code. `throttled`, the compute throttle is on this
 * frame: a sun's clipmap level takes the bias of its own map (`markedLevelText`).
 *
 * `input` `strands` (`inputType.ts`, the reference's hair input): the same marks over the strands' pixels
 * — a group a tile of the list of all the tiles with strands (an indirect dispatch over it), a lane a
 * pixel of it on the stride, valid where the depth of the nearest strand is (binding 0,
 * `VSM_STRANDS_MARKING_BINDING`, the tiles' counts at 9, a uniform, and their list at 10) —, a strand
 * spared the back-face cull and the first-person rules, and reading no surface. Neither the front layer
 * nor the water is marked from them. The reference takes the pixel at its thread's rank in the whole
 * dispatch, the tile it reads left unused: here the pixels are the tile's own.
 *
 * `locals` false leaves the local lights' marks out: the pages of their maps are then marked from the sampled lighting's samples alone
 * (`manyLightsSampled/vsmSampleMarkingWgsl.ts`).
 */
export const vsmPixelPageMarkingWgsl = (
  layout: VsmLayout,
  front = false,
  water = false,
  throttled = false,
  input: VsmInputType = 'gbuffer',
  locals = true,
) => {
  const strands = input === 'strands'
  return wgslProgram(
    `${strands ? '@group(1) @binding(0) var hairDepth:texture_2d<f32>;' : '@group(1) @binding(0) var depth:texture_depth_2d;'}
${pixelMarkingHead(front, water, strands)}${pixelMarkingDirectional(front, water, strands)}${locals ? pixelMarkingLocal(strands) : '\n}'}
`,
    [
      VSM_HANDLE_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_MARKING_PARAMS_WGSL,
      VIEW_WGSL,
      ...(strands ? [hairTilePixel] : [isFirstPerson]),
      vsmBindingsWgsl(0, VSM_PIXELS_SPECS, layout),
      DIRECT_LIGHT_WGSL,
      localLightReaches,
      ...(strands ? [] : [vsmSubsurfaceModel]),
      TILE_SLICE_WGSL,
      pixelCellWgsl(),
      SHADOW_SLICE_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      vsmPageMarkingBlock(throttled, layout.prefilteredDistant),
      WORLD_AT_WGSL,
      FLAT_INDEX_WGSL,
      ceilDivWgsl,
      ...(front ? [clipToFramebuffer] : []),
    ],
  )
}
