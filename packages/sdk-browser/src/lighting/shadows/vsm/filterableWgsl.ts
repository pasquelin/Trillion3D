/**
 * THE PREFILTERED DISTANT SHADOW'S FILTER KERNELS (`pageManagementEncode.ts` runs them after the
 * static merge, `prefilteredConstants.ts` is their interface): the pool pages of the clipmap levels that fall
 * back on a coarser level, their depths made a 0 or 1 occlusion, blurred, merged down the clipmap, in
 * bytes. A separable pass, a group a line of a page, loads the line once, with the two texels either
 * side of it, into workgroup memory; a bilinear read of a byte pool is made by hand.
 * - `filterableX` along the rows, into the temporary pool; `filterableY` down the columns, then the
 *   previous frame's value blended in, into the separate pool.
 * - `filterableBorder` and `filterableBorderMerged` fill the border of the separate and the merged pool.
 * - `filterableMergeDown` multiplies each texel by the bilinear read of every coarser level.
 */
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { inverse3 } from '../../../../../math/src/wgsl/matrix.ts'
import { FLAT_INDEX_WGSL } from '../../../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL, VSM_PAGE_TEXELS, VSM_PROJECTION_RECORD_BYTES } from './constants.ts'
import { VSM_FILTER_BYTE_WGSL, vsmFilterableBytesWgsl } from './filterableBytesWgsl.ts'
import { propagateFilterable } from './filterablePropagateWgsl.ts'
import { VSM_FILTER_LIST_FILTERABLE, VSM_FILTER_LIST_SEPARABLE } from './prefilteredConstants.ts'
import { VSM_HISTORY_WGSL, VSM_PREFILTERED_WGSL } from './prefilteredWgsl.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from './pageTableWgsl.ts'
import { TILE_WGSL, type VsmPmKernel, vsmPmKernel } from './physicalPagesWgsl.ts'
import { VSM_PROJECTION_RECORD_WORD as WORD } from './projection/projectionData.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from './projection/projectionDataWgsl.ts'
import type { VsmBindingSpec } from './resources.ts'
import type { VsmLayout } from './layout.ts'

/** The taps either side of a texel: the kernel is 2 · this + 1 wide. */
const VSM_FILTER_EXTENT = 2
/** The texels a separable pass's workgroup holds of a line: the page's and the taps either side. */
const ROW_TEXELS = VSM_PAGE_TEXELS + 2 * VSM_FILTER_EXTENT
/** The coarser levels a merge down holds the page of in workgroup memory, past its own. */
const MERGE_LEVELS = 32

/** The pieces every kernel shares: which pool page a list entry names and the page next to a page. Reads
 *  the page lists (`vsmFilterablePages`) and the tables of the module's bindings. */
const COMMON = wgslBlock(
  'VSM_FILTER_COMMON_WGSL',
  [
    VSM_CONSTANTS_WGSL,
    VSM_PREFILTERED_WGSL,
    VSM_FILTER_BYTE_WGSL,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_TABLE_ORIGIN_WGSL,
    VSM_PAGE_LOOKUP_WGSL,
    FLAT_INDEX_WGSL,
  ],
  /* wgsl */ `
/** The pool page that entry \`item\` of list \`list\` names (the lists lie one after the other, a pool's pages each). */
fn vsmFilterPageIndex(list:u32,item:u32)->u32{return vsmFilterablePagesLoad(list*vsm.poolPages+item);}
/** A page of the map mapped at its own level: its pool address. */
struct VsmFilterPage{valid:bool,address:vec2u,}
fn vsmFilterPageAt(h:VsmHandle,v:vec2i)->VsmFilterPage{
 var r:VsmFilterPage;
 if(!vsmPageInRange(v,0u)){return r;}
 let e=vsmUnpackTableEntry(vsmTableWord(vsmTableEntryOf(h,0u,vec2u(v))));
 if(e.thisLevelMapped){r.valid=true;r.address=e.physicalAddress;}
 return r;
}
`,
)

/** The separable passes' pieces: the group's page and line, the line the workgroup holds, the tap of
 *  a line past a page's edge and the kernel's weights. */
const ROW = wgslBlock(
  'VSM_FILTER_ROW_WGSL',
  [COMMON],
  /* wgsl */ `
${wgslConsts({ VSM_FILTER_EXTENT }, 'i32')}
/** The line of a page the filter holds, its texels with the two taps either side. */
var<workgroup> vsmFilterRow:array<f32,${ROW_TEXELS}>;
/** What a separable pass's group works on: the pool page, its record, and the line of it. */
struct VsmFilterGroup{page:u32,line:u32,info:VsmPoolPageInfo,}
fn vsmFilterGroupOf(wid:vec3u,count:vec3u)->VsmFilterGroup{
 let index=flatIndex(wid,count,1u);
 let page=vsmFilterPageIndex(VSM_FILTER_LIST_SEPARABLE,index>>VSM_LOG2_PAGE);
 return VsmFilterGroup(page,index&VSM_PAGE_TEXEL_MASK,vsmPoolPageInfo[page]);
}
/** The texel a tap reads: the pool page \`page\` and the coordinate along the line. */
struct VsmFilterTap{page:vec2u,along:u32,}
/** Tap \`k\` (from -2 to the page's side + 1) of a line of the page \`own\` (virtual page \`vPage\`) along
 *  \`axis\`: inside the page its own texel; past an edge the texel across it of the next page, or,
 *  with no page mapped there, the page's own edge texel. */
fn vsmFilterTap(h:VsmHandle,vPage:vec2u,own:vec2u,axis:vec2i,k:i32)->VsmFilterTap{
 let side=i32(VSM_PAGE_TEXELS);
 if(k>=0&&k<side){return VsmFilterTap(own,u32(k));}
 let upper=k>=side;
 let next=vsmFilterPageAt(h,vec2i(vPage)+axis*select(-1,1,upper));
 if(next.valid){return VsmFilterTap(next.address,u32(select(k+side,k-side,upper)));}
 return VsmFilterTap(own,select(0u,VSM_PAGE_TEXEL_MASK,upper));
}
/** The tap the thread \`lane\` below four loads beside the page's texels: -2, -1, then the side and the side + 1. */
fn vsmFilterBorderTap(lane:u32)->i32{
 let nearEdge=i32(lane&1u);
 return select(nearEdge-VSM_FILTER_EXTENT,nearEdge+i32(VSM_PAGE_TEXELS),lane>=2u);
}
/** The texel of a tap on the line \`lane\` along \`axis\`. */
fn vsmFilterTexel(tap:VsmFilterTap,lane:u32,axis:vec2i)->vec2u{
 return select(vec2u(tap.along,lane),vec2u(lane,tap.along),axis.y!=0);
}
/** The kernel's weight (over 16) of the tap \`offset\` from the texel: 1, 4, 6, 4, 1. */
fn vsmFilterWeight(offset:i32)->f32{
 let a=abs(offset);
 return select(select(1.0,4.0,a==1),6.0,a==0);
}
/** The line's 5-tap sum at \`texel\`, over 16, of the row the workgroup holds. */
fn vsmFilterRowSum(texel:u32)->f32{
 var sum=0.0;
 for(var offset=-VSM_FILTER_EXTENT;offset<=VSM_FILTER_EXTENT;offset++){
  sum+=vsmFilterWeight(offset)*vsmFilterRow[u32(i32(texel)+VSM_FILTER_EXTENT+offset)];
 }
 return sum*(1.0/16.0);
}
/** Where the line's texel \`k\` lies in the row the workgroup holds. */
fn vsmFilterRowSlot(k:i32)->u32{return u32(k+VSM_FILTER_EXTENT);}
`,
)

/** Group-0 bindings every kernel shares, from binding 0: the tables the page work reads. */
const TABLE_SPECS: VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'poolPageInfo', binding: 1 },
  { resource: 'pageTable', binding: 2 },
  { resource: 'projectionData', binding: 3 },
]

/** The temporary pool of the separable passes: the merged pool's buffer, cleared before each use. */
const TEMP_SPEC = { resource: 'filterableMerged', name: 'vsmFilterableTemp' } as const

const X_WGSL = wgslBlock(
  'filterableX',
  [ROW, vsmFilterableBytesWgsl('vsmFilterableTemp', { put: true })],
  /* wgsl */ `
/** The occlusion of a depth against the level's inner depth: 0 above it, else 1. */
fn vsmFilterableOcclusion(depth:f32,testDepth:f32)->f32{return select(1.0,0.0,depth>testDepth);}
/** The occlusion of the pool texel \`texel\` of the page at \`address\`. */
fn vsmFilterableDepthAt(address:vec2u,texel:vec2u,testDepth:f32)->f32{
 return vsmFilterableOcclusion(bitcast<f32>(vsmPoolLoad(address*VSM_PAGE_TEXELS+texel,0u)),testDepth);
}
/** The thread \`texel\` of a row's group loads its occlusion, and the first four the taps beside the row. */
fn vsmFilterableXLoad(g:VsmFilterGroup,texel:u32){
 let h=vsmHandleFromId(g.info.mapId);
 let own=vsmPoolPageOf(g.page);
 let axis=vec2i(1,0);
 let testDepth=vsmProjectionData[g.info.mapId].dynamicDepthCullRange.x;
 vsmFilterRow[vsmFilterRowSlot(i32(texel))]=vsmFilterableDepthAt(own,vec2u(texel,g.line),testDepth);
 if(texel<4u){
  let k=vsmFilterBorderTap(texel);
  let tap=vsmFilterTap(h,g.info.pageAddress,own,axis,k);
  vsmFilterRow[vsmFilterRowSlot(k)]=vsmFilterableDepthAt(tap.page,vsmFilterTexel(tap,g.line,axis),testDepth);
 }
}
fn vsmFilterableXStore(g:VsmFilterGroup,texel:u32){
 vsmFilterableTempPut(vsmFilterTempByte(g.page,vec2u(texel,g.line)),vsmFilterRowSum(texel));
}
@compute @workgroup_size(VSM_PAGE_TEXELS)
fn vsmFilterableX(@builtin(local_invocation_index) texel:u32,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) count:vec3u){
 let g=vsmFilterGroupOf(wid,count);
 vsmFilterableXLoad(g,texel);
 workgroupBarrier();
 vsmFilterableXStore(g,texel);
}`,
)

/** The first filter: the occlusion of the pages' dynamic depths, along each row, into the temp pool. */
function filterableX(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    ...TABLE_SPECS,
    { resource: 'pagePool', binding: 4, slices: 1 },
    { resource: 'filterablePages', binding: 5 },
    { ...TEMP_SPEC, binding: 6, access: 'atomic' },
  ]
  return vsmPmKernel(layout, 'FilterableX', specs, X_WGSL)
}

/** The previous frame's map `id` as the history holds it: the words of its record the filter reads. */
const PREVIOUS_MAP = wgslBlock(
  'VSM_FILTER_PREVIOUS_MAP_WGSL',
  [COMMON, VSM_HISTORY_WGSL],
  /* wgsl */ `
struct VsmPrevMap{
 handle:VsmHandle,
 mapLevel:i32,
 levelsLeft:i32,
 levelBias:f32,
 flags:u32,
 shiftHigh:vec3f,
 shiftLow:vec3f,
 origin:vec3f,
 toUv:mat4x4f,
}
fn vsmPrevWord(id:u32,word:u32)->u32{
 return vsmFilterableHistoryLoad(vsmHistoryRecordsWord()+id*${VSM_PROJECTION_RECORD_BYTES / 4}u+word);
}
fn vsmPrevFloat(id:u32,word:u32)->f32{return bitcast<f32>(vsmPrevWord(id,word));}
fn vsmPrevVec3(id:u32,word:u32)->vec3f{
 return vec3f(vsmPrevFloat(id,word),vsmPrevFloat(id,word+1u),vsmPrevFloat(id,word+2u));
}
fn vsmPrevVec4(id:u32,word:u32)->vec4f{return vec4f(vsmPrevVec3(id,word),vsmPrevFloat(id,word+3u));}
fn vsmPrevMapOf(id:u32)->VsmPrevMap{
 var m:VsmPrevMap;
 m.handle=VsmHandle(id,vsmPrevWord(id,${WORD.tableOrigin}u),vsmPrevWord(id,${WORD.finestMip}u));
 m.mapLevel=bitcast<i32>(vsmPrevWord(id,${WORD.mapLevel}u));
 m.levelsLeft=bitcast<i32>(vsmPrevWord(id,${WORD.levelsLeft}u));
 m.levelBias=vsmPrevFloat(id,${WORD.levelBias}u);
 m.flags=vsmPrevWord(id,${WORD.flags}u);
 m.shiftHigh=vsmPrevVec3(id,${WORD.originShiftHigh}u);
 m.shiftLow=vsmPrevVec3(id,${WORD.originShiftLow}u);
 m.origin=vsmPrevVec3(id,${WORD.clipmapOrigin}u);
 let w=${WORD.shiftedToMapUv}u;
 m.toUv=mat4x4f(vsmPrevVec4(id,w),vsmPrevVec4(id,w+4u),vsmPrevVec4(id,w+8u),vsmPrevVec4(id,w+12u));
 return m;
}`,
)

/** What a group's page needs of its map and the previous frame's, the same for every texel of it: read
 *  by one thread, held in workgroup memory. */
const BLEND_GROUP = wgslBlock(
  'VSM_FILTER_BLEND_GROUP_WGSL',
  [PREVIOUS_MAP, VSM_PROJECTION_DATA_WGSL, VSM_PROJECTION_DATA_READ_WGSL, inverse3],
  /* wgsl */ `
/** The previous frame's first map of the page's clipmap (\`previous\`, none when negative) and its record, the page's map taken
 *  back from its UV and depth (a map's UV matrix being orthographic, its last row (0, 0, 0, 1)) and its origin shift. */
struct VsmBlendGroup{previous:i32,base:VsmPrevMap,fromMap:mat3x3f,uvOffset:vec3f,depth:f32,shiftHigh:vec3f,shiftLow:vec3f,}
var<workgroup> vsmBlendGroup:VsmBlendGroup;
fn vsmFilterableBlendSetup(info:VsmPoolPageInfo){
 let pd=vsmProjectionOf(vsmHandleFromId(info.mapId));
 let baseId=i32(info.mapId)-i32(vsmClipmapLevelIndex(pd));
 let previous=i32(vsmFilterableHistoryLoad(vsmHistoryIdsWord()+u32(baseId)-vsmHistorySunBase()))-1;
 vsmBlendGroup.previous=previous;
 if(previous<0){return;}
 let toUv=pd.shiftedToMapUv;
 vsmBlendGroup.base=vsmPrevMapOf(u32(previous));
 vsmBlendGroup.fromMap=inverse3(mat3x3f(toUv[0].xyz,toUv[1].xyz,toUv[2].xyz));
 vsmBlendGroup.uvOffset=toUv[3].xyz;
 vsmBlendGroup.depth=(pd.dynamicDepthCullRange.x+pd.dynamicDepthCullRange.y)*0.5;
 vsmBlendGroup.shiftHigh=pd.originShiftHigh;
 vsmBlendGroup.shiftLow=pd.originShiftLow;
}`,
)

/** The previous frame's filtered value at a place, from its separate pool. */
const PREVIOUS_SAMPLE = wgslBlock(
  'VSM_FILTER_PREVIOUS_SAMPLE_WGSL',
  [BLEND_GROUP, vsmFilterableBytesWgsl('vsmPrevFilterableSeparate', { bilinear: true })],
  /* wgsl */ `
struct VsmPrevSample{valid:bool,value:f32,}
/** The value at \`here\`, a place in the frame of the map of the group's page, in the previous frame's clipmap: that of
 *  the level the place falls in. The bias is the previous records' (the reference reads the current buffer at the
 *  previous ids, ProjectionCommon.ush:62-71, an unrelated map once ids move). Valid where the previous receiver cover
 *  holds the texel (the maps that keep one) and the page was a secondary request. */
fn vsmFilterablePrevious(here:vec3f)->VsmPrevSample{
 var r:VsmPrevSample;
 let b=vsmBlendGroup.base;
 let inBase=here+vsmSubtractHighLow(b.shiftHigh,b.shiftLow,vsmBlendGroup.shiftHigh,vsmBlendGroup.shiftLow);
 let toOrigin=inBase-b.origin;
 let level=vsmLevelOfDistanceSq(dot(toOrigin,toOrigin));
 var bias=b.levelBias;
 let slot=vsmClipmapIndexOfLevel(b.mapLevel,level);
 if(slot<b.levelsLeft){bias=vsmPrevFloat(b.handle.id+u32(slot),${WORD.levelBias}u);}
 let index=max(0,i32(floor(level+bias))-b.mapLevel);
 if(index>=b.levelsLeft){return r;}
 let m=vsmPrevMapOf(b.handle.id+u32(index));
 let inLevel=inBase+vsmSubtractHighLow(m.shiftHigh,m.shiftLow,b.shiftHigh,b.shiftLow);
 let texel=(m.toUv*vec4f(inLevel,1.0)).xy*f32(VSM_LEVEL0_TEXELS);
 let at=vsmLevelTexelAt(texel);
 if(!vsmPageInRange(at.vPage,0u)){return r;}
 let cell=vsmTableEntryOf(m.handle,0u,vec2u(at.vPage));
 if((m.flags&VSM_MAP_COVERAGE)!=0u){
  let texelAt=vec2u(floor(texel));
  let quadrant=(texelAt>>vec2u(VSM_LOG2_PAGE-1u))&vec2u(1u);
  let bit=(texelAt>>vec2u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS))&vec2u(VSM_COVER_CELL_MASK);
  let mask=vsmFilterableHistoryLoad(vsmHistoryCoverWord()+vsmCoverIndex(cell.tableXY*2u+quadrant,0u));
  if((mask&(1u<<(bit.y*4u+bit.x)))==0u){return r;}
 }
 let entry=vsmFilterableHistoryLoad(vsmHistoryTableWord()+vsmTableIndex(cell.tableXY));
 if(!vsmEntrySecondary(entry)){return r;}
 let page=vsmPoolIndexOf(vsmUnpackTableEntry(entry).physicalAddress);
 r.value=vsmPrevFilterableSeparateBilinear(page,at.inPage);
 r.valid=true;
 return r;
}`,
)

/** The history blend of texel \`local\` of a page: the filtered value \`current\` moved toward the previous
 *  frame's at the texel's place by (1 - blend), at least a 255th; \`current\` where that place has none. */
const BLEND = wgslBlock(
  'VSM_FILTER_BLEND_WGSL',
  [PREVIOUS_SAMPLE],
  /* wgsl */ `
fn vsmFilterableBlend(current:f32,info:VsmPoolPageInfo,local:vec2u)->f32{
 if(vsmBlendGroup.previous<0){return current;}
 let texel=vec2f(info.pageAddress*VSM_PAGE_TEXELS+local)+0.5;
 let here=vsmBlendGroup.fromMap*(vec3f(texel/f32(VSM_LEVEL0_TEXELS),vsmBlendGroup.depth)-vsmBlendGroup.uvOffset);
 let previous=vsmFilterablePrevious(here);
 if(!previous.valid){return current;}
 var delta=(current-previous.value)*(1.0-vsmHistoryBlend());
 if(abs(delta)<1.0/255.0){delta=sign(delta)/255.0;}
 return saturate(previous.value+delta);
}`,
)

const Y_WGSL = wgslBlock(
  'filterableY',
  [
    ROW,
    BLEND,
    vsmFilterableBytesWgsl('vsmFilterableTemp', { at: true }),
    vsmFilterableBytesWgsl('vsmFilterableSeparate', { put: true }),
  ],
  /* wgsl */ `
/** The thread \`texel\` of a column's group loads the temporary value, and the first four the taps beside the column; the
 *  first, with the history on, the group's share of the blend. */
fn vsmFilterableYLoad(g:VsmFilterGroup,texel:u32){
 let h=vsmHandleFromId(g.info.mapId);
 let own=vsmPoolPageOf(g.page);
 let axis=vec2i(0,1);
 vsmFilterRow[vsmFilterRowSlot(i32(texel))]=vsmFilterableTempAt(vsmFilterTempByte(g.page,vec2u(g.line,texel)));
 if(texel<4u){
  let k=vsmFilterBorderTap(texel);
  let tap=vsmFilterTap(h,g.info.pageAddress,own,axis,k);
  vsmFilterRow[vsmFilterRowSlot(k)]=vsmFilterableTempAt(vsmFilterTempByte(vsmPoolIndexOf(tap.page),vsmFilterTexel(tap,g.line,axis)));
 }
 if(texel==0u&&vsmHistoryBlend()>0.0){vsmFilterableBlendSetup(g.info);}
}
fn vsmFilterableYStore(g:VsmFilterGroup,texel:u32){
 var value=vsmFilterRowSum(texel);
 if(vsmHistoryBlend()>0.0){value=vsmFilterableBlend(value,g.info,vec2u(g.line,texel));}
 vsmFilterableSeparatePut(vsmFilterByte(g.page,vec2u(g.line,texel)+VSM_FILTERABLE_BORDER),value);
}
@compute @workgroup_size(VSM_PAGE_TEXELS)
fn vsmFilterableY(@builtin(local_invocation_index) texel:u32,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) count:vec3u){
 let g=vsmFilterGroupOf(wid,count);
 vsmFilterableYLoad(g,texel);
 workgroupBarrier();
 vsmFilterableYStore(g,texel);
}`,
)

/** The second filter: down each column, then blended with the previous frame's, into the separate pool. */
function filterableY(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    ...TABLE_SPECS,
    { resource: 'filterablePages', binding: 4 },
    { ...TEMP_SPEC, binding: 5 },
    { resource: 'filterableSeparate', binding: 6, access: 'atomic' },
    { resource: 'filterableSeparate', binding: 7, prev: true },
    { resource: 'filterableHistory', binding: 8 },
  ]
  return vsmPmKernel(layout, 'FilterableY', specs, Y_WGSL)
}

const BORDER_WGSL = wgslBlock(
  'filterableBorder',
  [COMMON, vsmFilterableBytesWgsl('vsmFilterableTarget', { at: true, put: true })],
  /* wgsl */ `
/** The border texel \`lane\` along the edge \`dir\` (a side or a corner) of the page, copied from the texel
 *  of the edge across it of the next page, or from the page's own edge where none is mapped. */
fn vsmFilterBorderCopy(h:VsmHandle,page:u32,vPage:vec2u,dir:vec2i,lane:u32){
 let edge=vec2u(max(dir,vec2i(0)))*VSM_PAGE_TEXEL_MASK;
 var sourcePage=page;
 var sourceEdge=edge;
 let next=vsmFilterPageAt(h,vec2i(vPage)+dir);
 if(next.valid){
  sourcePage=vsmPoolIndexOf(next.address);
  sourceEdge=vec2u(max(-dir,vec2i(0)))*VSM_PAGE_TEXEL_MASK;
 }
 let along=vec2u(abs(dir).yx)*lane;
 let border=vec2i(i32(VSM_FILTERABLE_BORDER));
 let destination=vec2u(border+vec2i(edge)+dir)+along;
 let source=VSM_FILTERABLE_BORDER+sourceEdge+along;
 vsmFilterableTargetPut(vsmFilterByte(page,destination),vsmFilterableTargetAt(vsmFilterByte(sourcePage,source)));
}
@compute @workgroup_size(VSM_PAGE_TEXELS)
fn vsmFilterableBorder(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) count:vec3u){
 let page=vsmFilterPageIndex(VSM_FILTER_LIST_SEPARABLE,flatIndex(wid,count,1u));
 let info=vsmPoolPageInfo[page];
 let h=vsmHandleFromId(info.mapId);
 vsmFilterBorderCopy(h,page,info.pageAddress,vec2i(0,-1),lane);
 vsmFilterBorderCopy(h,page,info.pageAddress,vec2i(0,1),lane);
 vsmFilterBorderCopy(h,page,info.pageAddress,vec2i(-1,0),lane);
 vsmFilterBorderCopy(h,page,info.pageAddress,vec2i(1,0),lane);
 if(lane<4u){
  let corner=vec2i(i32(lane&1u),i32(lane>>1u))*2-vec2i(1);
  vsmFilterBorderCopy(h,page,info.pageAddress,corner,0u);
 }
}`,
)

/** The border pass over `pool`, the pool of the separable filter or the merged one. */
function filterableBorder(layout: VsmLayout, pool: 'filterableSeparate' | 'filterableMerged') {
  const specs: VsmBindingSpec[] = [
    ...TABLE_SPECS,
    { resource: 'filterablePages', binding: 4 },
    { resource: pool, binding: 5, access: 'atomic', name: 'vsmFilterableTarget' },
  ]
  const label = pool === 'filterableMerged' ? 'FilterableBorderMerged' : 'FilterableBorder'
  return vsmPmKernel(layout, label, specs, BORDER_WGSL, { entryPoint: 'vsmFilterableBorder' })
}

const MERGE_WGSL = wgslBlock(
  'filterableMergeDown',
  [
    COMMON,
    TILE_WGSL,
    VSM_PROJECTION_DATA_READ_WGSL,
    vsmFilterableBytesWgsl('vsmFilterableSeparate', { at: true, bilinear: true }),
    vsmFilterableBytesWgsl('vsmFilterableMerged', { put: true }),
  ],
  /* wgsl */ `
/** The levels the clipmap's coarser pages are held for: the pool page + 1 of the one that adds its shadow, else 0, and
 *  the bias that takes a texel of the first level to the level's. */
var<workgroup> vsmMergePage:array<u32,${MERGE_LEVELS}>;
var<workgroup> vsmMergeBias:array<vec2f,${MERGE_LEVELS}>;
/** The levels of the page's clipmap from its own, the held ones at most. */
fn vsmMergeLevels(dest:VsmProjectionData)->u32{return min(u32(dest.levelsLeft),${MERGE_LEVELS}u);}
/** What a merge down's group works on: the tile, its pool page's record and the map's. */
struct VsmMergeGroup{tile:PmTile,info:VsmPoolPageInfo,dest:VsmProjectionData,}
fn vsmMergeGroupOf(wid:vec3u,count:vec3u)->VsmMergeGroup{
 let index=flatIndex(wid,count,1u);
 let tile=pmTileOf(index,vsmFilterPageIndex(VSM_FILTER_LIST_FILTERABLE,index>>PM_LOG2_TILES));
 let info=vsmPoolPageInfo[tile.poolPageIndex];
 return VsmMergeGroup(tile,info,vsmProjectionOf(vsmHandleFromId(info.mapId)));
}
/** The thread \`lane\` of a tile finds the page of the level \`lane + 1\` that covers the tile's first texel,
 *  and whether it was written. */
fn vsmFilterableMergeSource(g:VsmMergeGroup,lane:u32){
 let level=lane+1u;
 if(level>=vsmMergeLevels(g.dest)){return;}
 let source=vsmHandleOffset(g.dest.handle,i32(level));
 let scale=1.0/f32(1u<<level);
 let quarter=f32(VSM_LEVEL0_PAGES>>2u);
 let bias=vec2f(vsmProjectionData[source.id].cornerSteps)*quarter-vec2f(g.dest.cornerSteps)*quarter*scale;
 let tileTexel=vec2f(g.info.pageAddress*VSM_PAGE_TEXELS+g.tile.tileOrigin);
 let sourcePage=vsmFilterPageAt(source,vsmLevelTexelAt(tileTexel*scale+bias).vPage);
 var held=0u;
 if(sourcePage.valid){
  let sourceIndex=vsmPoolIndexOf(sourcePage.address);
  // A coarser page that was written adds its shadow.
  if((vsmPoolPageInfo[sourceIndex].flags&VSM_META_DYNAMIC_CLEARED)==0u){held=sourceIndex+1u;}
 }
 vsmMergePage[level]=held;
 vsmMergeBias[level]=bias;
}
/** The 2 x 2 texels of the thread \`lane\` of the tile, merged down the levels held. */
fn vsmFilterableMergeStore(g:VsmMergeGroup,lane:vec2u){
 let page=g.tile.poolPageIndex;
 let local=g.tile.tileOrigin+lane;
 var o=array<vec2u,4>(vec2u(0u,0u),vec2u(PM_TILE_LANES,0u),vec2u(0u,PM_TILE_LANES),vec2u(PM_TILE_LANES,PM_TILE_LANES));
 var merged=array<f32,4>(1.0,1.0,1.0,1.0);
 // A page whose dynamic layer was written starts at its own value.
 if((g.info.flags&VSM_META_DYNAMIC_CLEARED)==0u){
  for(var k=0u;k<4u;k++){merged[k]=vsmFilterableSeparateAt(vsmFilterByte(page,local+o[k]+VSM_FILTERABLE_BORDER));}
 }
 let texel=vec2f(g.info.pageAddress*VSM_PAGE_TEXELS+local)+0.5;
 var scale=0.5;
 for(var level=1u;level<vsmMergeLevels(g.dest);level++){
  let source=vsmMergePage[level];
  if(source!=0u){
   let at=texel*scale+vsmMergeBias[level];
   for(var k=0u;k<4u;k++){
    merged[k]*=vsmFilterableSeparateBilinear(source-1u,(at+vec2f(o[k])*scale)%f32(VSM_PAGE_TEXELS));
   }
  }
  scale*=0.5;
 }
 for(var k=0u;k<4u;k++){vsmFilterableMergedPut(vsmFilterByte(page,local+o[k]+VSM_FILTERABLE_BORDER),merged[k]);}
}
@compute @workgroup_size(PM_TILE_LANES,PM_TILE_LANES)
fn vsmFilterableMergeDown(@builtin(local_invocation_id) lane:vec3u,@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) count:vec3u){
 let g=vsmMergeGroupOf(wid,count);
 vsmFilterableMergeSource(g,lane.y*PM_TILE_LANES+lane.x);
 workgroupBarrier();
 vsmFilterableMergeStore(g,lane.xy);
}`,
)

/** The merge down the clipmap: each texel of the tile's page times the coarser levels', into the merged pool. */
function filterableMergeDown(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    ...TABLE_SPECS,
    { resource: 'filterablePages', binding: 4 },
    { resource: 'filterableSeparate', binding: 5 },
    { resource: 'filterableMerged', binding: 6, access: 'atomic' },
  ]
  return vsmPmKernel(layout, 'FilterableMergeDown', specs, MERGE_WGSL)
}

/** The kernels of the prefiltered distant shadow for `layout`: the requests' propagation, then the
 *  filters in the order they run. */
export function vsmFilterableKernels(layout: VsmLayout) {
  return {
    propagateFilterable: propagateFilterable(layout),
    filterableX: filterableX(layout),
    filterableY: filterableY(layout),
    filterableBorder: filterableBorder(layout, 'filterableSeparate'),
    filterableMergeDown: filterableMergeDown(layout),
    filterableBorderMerged: filterableBorder(layout, 'filterableMerged'),
  }
}
