/**
 * Page table addressing and lookup: the page handle, the page access and the projection sampling.
 *
 * The 2D tables (one texel per page entry) are storage buffers, linearised row by row: texel
 * (x, y) of mip m lives at `mipOffset[m] + y·(W>>m) + x` (`vsmTableIndex`, `vsmPageMarkIndex`,
 * `vsmCoverIndex`). The texel address math (`vsmTableLevelOrigin`,
 * `vsmTableEntryAt`, `vsmMipTailOffset`) is that of a 2D table, unchanged, so the same texel
 * holds the same entry.
 *
 * Three strings, each needing the previous ones:
 * - `VSM_HANDLE_WGSL`: the shadow map handle. No bindings.
 * - `VSM_PAGE_ADDRESS_WGSL`: addressing, entry encode/decode, page info. Needs the `vsm`
 *   uniform (`VSM_UNIFORMS_WGSL`) and `VSM_CONSTANTS_WGSL`.
 * - `VSM_PAGE_LOOKUP_WGSL`: page table reads. Needs `vsmPageTableLoad(index)`,
 *   emitted by the binding builder.
 * - `VSM_PAGE_MARKS_GATHER_WGSL` / `VSM_COVER_GATHER_WGSL`: the 2x2 gathers,
 *   needing `vsmPageMarksLoad(index)` / `vsmReceiverCoverLoad(index)`.
 */

/** The shadow map handle: its id and whether it is a single-page map. */
export const VSM_HANDLE_WGSL = /* wgsl */ `
struct VsmHandle{id:u32,isSinglePage:bool,}
fn vsmHandleFromId(id:u32)->VsmHandle{return VsmHandle(id,id<VSM_SINGLE_PAGE_MAP_SLOTS);}
fn vsmHandleFromIdDirectional(id:u32)->VsmHandle{return VsmHandle(id,false);}
fn vsmHandleInvalid()->VsmHandle{return VsmHandle(0xFFFFFFFFu,false);}
/** Signed offset; keeps the single-page bit of the source handle . */
fn vsmHandleOffset(h:VsmHandle,offset:i32)->VsmHandle{return VsmHandle(u32(i32(h.id)+offset),h.isSinglePage);}
fn vsmHandleIsValid(h:VsmHandle)->bool{return h.id!=0xFFFFFFFFu;}
`

/** Page-address arithmetic and the buffer linearisation of the 2D tables. */
export const VSM_PAGE_ADDRESS_WGSL = /* wgsl */ `
fn vsmLog2PagesAtLevel(level:u32)->u32{return VSM_LOG2_LEVEL0_PAGES-level;}
fn vsmPagesAtLevel(level:u32)->u32{return 1u<<vsmLog2PagesAtLevel(level);}
fn vsmTexelsAtLevel(level:u32)->u32{return VSM_LEVEL0_TEXELS>>level;}
/** Mip tail packed below level 0 so X wraps with a power of two. */
fn vsmMipTailOffset(mipLevel:u32)->vec2u{
 var r=vec2u(0u,0u);
 if(mipLevel>0u){
  r.y+=VSM_LEVEL0_PAGES;
  let maxMask=(1u<<(VSM_MIPS-1u))-1u;
  let startBit=VSM_MIPS-mipLevel;
  r.x+=maxMask&(maxMask<<startBit);
 }
 return r;
}
struct VsmTableLevel{isSinglePage:bool,firstCell:vec2u,}
/** Single-page maps pack into the first 128x128 block; full maps skip it (+1). */
fn vsmTableLevelOrigin(h:VsmHandle,mipLevel:u32)->VsmTableLevel{
 var r:VsmTableLevel;
 r.isSinglePage=h.isSinglePage;
 if(r.isSinglePage){
  r.firstCell=vec2u(h.id&VSM_PAGE_TEXEL_MASK,h.id>>VSM_LOG2_PAGE);
 }else{
  let fullId=(h.id-VSM_SINGLE_PAGE_MAP_SLOTS)+1u;
  r.firstCell=vec2u((fullId&vsm.pageTableRowMask)*VSM_LEVEL0_PAGES,(fullId>>vsm.pageTableRowShift)*VSM_PAGE_TABLE_BLOCK_HEIGHT);
  r.firstCell+=vsmMipTailOffset(mipLevel);
 }
 return r;
}
/** The texel address of one entry in the global 2D table. */
struct VsmTableCell{tableXY:vec2u,}
fn vsmTableCellPack(o:VsmTableCell)->u32{return (o.tableXY.x<<16u)|o.tableXY.y;}
fn vsmTableCellUnpack(p:u32)->VsmTableCell{return VsmTableCell(vec2u(p>>16u,p&0xFFFFu));}
fn vsmTableEntryAt(levelOffset:VsmTableLevel,level:u32,pageAddress:vec2u)->VsmTableCell{
 var r=VsmTableCell(levelOffset.firstCell);
 if(!levelOffset.isSinglePage){r.tableXY+=pageAddress;}
 return r;
}
fn vsmTableEntryOf(h:VsmHandle,level:u32,pageAddress:vec2u)->VsmTableCell{
 return vsmTableEntryAt(vsmTableLevelOrigin(h,level),level,pageAddress);
}
fn vsmPageInRange(pageAddress:vec2i,level:u32)->bool{
 return all(pageAddress>=vec2i(0))&&all(pageAddress<vec2i(i32(vsmPagesAtLevel(level))));
}
/** Physical page index <-> pool page address (row = 128 pages). */
fn vsmPoolIndexOf(a:vec2u)->u32{return (a.y<<vsm.poolRowShift)+a.x;}
fn vsmPoolPageOf(i:u32)->vec2u{return vec2u(i&vsm.poolRowMask,i>>vsm.poolRowShift);}
/** The word of pool texel t's tile in \`tileDepths\`: its page's tiles of
 *  2^VSM_LOG2_TILE_DEPTH_TEXELS texels a side, row by row, after the pages before it. */
fn vsmTileDepthIndex(t:vec2u)->u32{
 let tiles=VSM_LOG2_PAGE-VSM_LOG2_TILE_DEPTH_TEXELS;
 let page=vsmPoolIndexOf(t>>vec2u(VSM_LOG2_PAGE));
 let tile=(t&vec2u(VSM_PAGE_TEXEL_MASK))>>vec2u(VSM_LOG2_TILE_DEPTH_TEXELS);
 return (page<<(2u*tiles))|(tile.y<<tiles)|tile.x;
}

/** A page table entry: [0:9] phys X, [10:19] phys Y, [20:25] coarser levels, b30 drawable, b31 mapped at some level. */
struct VsmTableEntry{
 physicalAddress:vec2u,
 coarserLevels:u32,
 anyLevelMapped:bool,
 thisLevelDrawable:bool,
 thisLevelMapped:bool,
}
fn vsmPackTableEntry(physicalAddress:vec2u,validForRendering:bool)->u32{
 return (physicalAddress.y<<10u)|physicalAddress.x
  |select(VSM_ENTRY_MAPPED_BIT,VSM_ENTRY_MAPPED_BIT|VSM_ENTRY_DRAWABLE_BIT,validForRendering);
}
/** Hierarchical pointer to a coarser mapped page, never valid for rendering (FillCoarserFallbacks). */
fn vsmPackFallbackEntry(physicalAddress:vec2u,coarserLevels:u32)->u32{
 return VSM_ENTRY_MAPPED_BIT|(coarserLevels<<20u)|(physicalAddress.y<<10u)|physicalAddress.x;
}
fn vsmUnpackTableEntry(v:u32)->VsmTableEntry{
 var r:VsmTableEntry;
 r.physicalAddress=vec2u(v&0x3FFu,(v>>10u)&0x3FFu);
 r.coarserLevels=(v>>20u)&0x3Fu;
 r.anyLevelMapped=(v&VSM_ENTRY_MAPPED_BIT)!=0u;
 r.thisLevelDrawable=(v&VSM_ENTRY_DRAWABLE_BIT)!=0u;
 r.thisLevelMapped=r.anyLevelMapped&&r.coarserLevels==0u;
 return r;
}

/** Linear index of page-table / page-request-flags texel (one mip). */
fn vsmTableIndex(t:vec2u)->u32{return t.y*vsm.pageTableSize.x+t.x;}
/** Linear index of page-marks texel at hierarchical mip m (texel already in mip m space). */
fn vsmPageMarkIndex(t:vec2u,m:u32)->u32{return vsmMarkMipOffset(m)+t.y*(vsm.pageTableSize.x>>m)+t.x;}
fn vsmPageMarkInBounds(t:vec2u,m:u32)->bool{return all(t<(vsm.pageTableSize>>vec2u(m)));}
/** Linear index of receiver-cover texel at mip m (2x the page table resolution at mip 0). */
fn vsmCoverIndex(t:vec2u,m:u32)->u32{return vsmCoverMipOffset(m)+t.y*(vsm.coverSize.x>>m)+t.x;}
fn vsmCoverInBounds(t:vec2u,m:u32)->bool{return all(t<(vsm.coverSize>>vec2u(m)));}
`

/** Page lookups. Needs `vsmPageTableLoad(index:u32)->u32` (emitted by `vsmBindingsWgsl`). */
export const VSM_PAGE_LOOKUP_WGSL = /* wgsl */ `
/** The entry's word, undecoded: what a reader keeps to decode it again. */
fn vsmTableWord(o:VsmTableCell)->u32{return vsmPageTableLoad(vsmTableIndex(o.tableXY));}
fn vsmTableEntryAtOffset(o:VsmTableCell)->VsmTableEntry{return vsmUnpackTableEntry(vsmTableWord(o));}
struct VsmLocalPage{
 valid:bool,
 coarserLevels:u32,
 mapTexelXY:vec2u,
 mapTexelPos:vec2f,
 poolTexel:vec2u,
}
/** The best-resolution mapped page at a UV, following the coarser-level count (local lights). */
fn vsmLocalPageAt(h:VsmHandle,mapUvAt:vec2f,finestMip:u32)->VsmLocalPage{
 let vPage=vec2u(mapUvAt*f32(VSM_LEVEL0_PAGES));
 let e=vsmUnpackTableEntry(vsmTableWord(vsmTableEntryOf(h,finestMip,vPage>>vec2u(finestMip))));
 var r:VsmLocalPage;
 r.valid=e.anyLevelMapped;
 r.coarserLevels=select(e.coarserLevels+finestMip,VSM_MIPS-1u,h.isSinglePage);
 r.mapTexelPos=mapUvAt*f32(vsmTexelsAtLevel(r.coarserLevels));
 r.mapTexelXY=vec2u(r.mapTexelPos);
 r.poolTexel=e.physicalAddress*VSM_PAGE_TEXELS+(r.mapTexelXY&vec2u(VSM_PAGE_TEXEL_MASK));
 return r;
}
`

/** A 2x2 gather as `name` over one table (its bounds test, loader and index): the 2x2
 *  texels at hierarchical mip pyramidMip in the order (-,+), (+,+), (+,-), (-,-), out-of-range ones 0. */
const gatherWgsl = (name: string, inBounds: string, load: string, index: string) => `
fn ${name}(texelCoord:vec2u,pyramidMip:u32)->vec4u{
 let t=texelCoord>>vec2u(pyramidMip);
 var a=array<vec2u,4>(vec2u(t.x,t.y+1u),vec2u(t.x+1u,t.y+1u),vec2u(t.x+1u,t.y),t);
 var r=vec4u(0u);
 for(var k=0u;k<4u;k++){
  if(${inBounds}(a[k],pyramidMip)){r[k]=${load}(${index}(a[k],pyramidMip));}
 }
 return r;
}`

/**
 * The 2x2 gather over the page marks (out-of-range texels read 0).
 * Needs `vsmPageMarksLoad(index:u32)->u32`.
 */
export const VSM_PAGE_MARKS_GATHER_WGSL = /* wgsl */ `${gatherWgsl('vsmGatherPageMarks', 'vsmPageMarkInBounds', 'vsmPageMarksLoad', 'vsmPageMarkIndex')}
fn vsmPageMarkWord(o:VsmTableCell)->u32{return vsmPageMarksLoad(vsmPageMarkIndex(o.tableXY,0u));}
`

/** The same gather over the receiver covers. Needs `vsmReceiverCoverLoad(index:u32)->u32`. */
export const VSM_COVER_GATHER_WGSL = /* wgsl */ `${gatherWgsl(
  'vsmGatherCover',
  'vsmCoverInBounds',
  'vsmReceiverCoverLoad',
  'vsmCoverIndex',
)}
`

/**
 * The shared structs. Their WGSL storage layout is the host's stride:
 * VsmPoolPageInfo 24 bytes (flags 0, lastWantedStamp 4, mapId 8,
 * mipLevel 12, pageAddress 16), VsmNextMap 16 bytes (flags 0, nextMapId 4,
 * pageShift 8).
 */
export const VSM_STRUCTS_WGSL = /* wgsl */ `
struct VsmPoolPageInfo{
 flags:u32,
 lastWantedStamp:u32,
 mapId:u32,
 mipLevel:u32,
 pageAddress:vec2u,
}
struct VsmNextMap{
 flags:u32,
 nextMapId:i32,
 pageShift:vec2i,
}
/** The mip level of a local light's footprint (extraBias >= 0). */
fn vsmLocalMipLevel(footprint:f32,mapBias:f32,pressureBias:f32,extraBias:f32)->u32{
 let mipLevelFloat=log2(footprint)+mapBias+pressureBias+extraBias;
 var mipLevel=u32(max(floor(mipLevelFloat),0.0));
 mipLevel=min(mipLevel,VSM_MIPS-1u);
 return mipLevel;
}
`
