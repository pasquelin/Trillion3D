import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { highHalf, lowBits, lowHalf } from '../../../math/src/wgsl/integer.ts'

/**
 * Page table addressing and lookup: the page handle, the page access and the projection sampling.
 *
 * The 2D tables (one texel per page entry) are storage buffers, linearised row by row: texel
 * (x, y) of mip m lives at `mipOffset[m] + y·(W>>m) + x` (`vsmTableIndex`, `vsmPageMarkIndex`,
 * `vsmCoverIndex`). The texel address math (`vsmTableLevelOrigin`,
 * `vsmTableEntryAt`, `vsmMipTailOffset`) is that of a 2D table, unchanged, so the same texel
 * holds the same entry.
 *
 * Each fragment lists the declarations its text uses; what a module's bindings provide
 * (`vsmBindingsWgsl`) the module brings:
 * - `VSM_HANDLE_WGSL`: the shadow map handle. No bindings.
 * - `VSM_PAGE_ADDRESS_WGSL`: addressing, entry encode/decode, page info. Reads the `vsm` uniform.
 * - `VSM_PAGE_LOOKUP_WGSL`: page table reads, through `vsmPageTableLoad(index)`.
 * - `VSM_PAGE_MARKS_GATHER_WGSL` / `VSM_COVER_GATHER_WGSL`: the 2x2 gathers, through
 *   `vsmPageMarksLoad(index)` / `vsmReceiverCoverLoad(index)`.
 */

/** The shadow map handle: its id and where its table lies — the origin and the finest mip its
 *  record carries (\`tableBlocks.ts\`), read once when the handle is made, through the module's
 *  \`vsmProjectionData\`, so that no table lookup reads the record again (\`vsmTableLevelOrigin\`). */
export const VSM_HANDLE_WGSL = wgslBlock(
  'VSM_HANDLE_WGSL',
  [VSM_CONSTANTS_WGSL],
  `
struct VsmHandle{id:u32,tableOrigin:u32,finestMip:u32,}
fn vsmHandleFromId(id:u32)->VsmHandle{
 return VsmHandle(id,vsmProjectionData[id].tableOrigin,vsmProjectionData[id].finestMip);
}
fn vsmHandleInvalid()->VsmHandle{return VsmHandle(0xFFFFFFFFu,0u,0u);}
/** The map \`offset\` ids on: a clipmap's next level, a cube's face. */
fn vsmHandleOffset(h:VsmHandle,offset:i32)->VsmHandle{return vsmHandleFromId(u32(i32(h.id)+offset));}
fn vsmHandleIsValid(h:VsmHandle)->bool{return h.id!=0xFFFFFFFFu;}
`,
)

/** Page-address arithmetic and the buffer linearisation of the 2D tables. */
export const VSM_PAGE_ADDRESS_WGSL = wgslBlock(
  'VSM_PAGE_ADDRESS_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_UNIFORMS_WGSL, lowHalf, highHalf, lowBits],
  `
fn vsmLog2PagesAtLevel(level:u32)->u32{return VSM_LOG2_LEVEL0_PAGES-level;}
fn vsmPagesAtLevel(level:u32)->u32{return 1u<<vsmLog2PagesAtLevel(level);}
fn vsmTexelsAtLevel(level:u32)->u32{return VSM_LEVEL0_TEXELS>>level;}
/** Where mip \`mipLevel\` of a table whose finest mip is \`finestMip\` lies in it: the finest at its
 *  origin, a side of S = 128 >> finest entries; the coarser ones in a row below it, each at the
 *  bits of S − 1 its rank leaves (S/2, S/4, … wide: X wraps with a power of two). */
fn vsmMipTailOffset(mipLevel:u32,finestMip:u32)->vec2u{
 var r=vec2u(0u,0u);
 let rel=mipLevel-finestMip;
 if(rel>0u){
  let side=VSM_LEVEL0_PAGES>>finestMip;
  r.y=side;
  let maxMask=side-1u;
  r.x=maxMask&(maxMask<<(VSM_MIPS-finestMip-rel));
 }
 return r;
}
struct VsmTableLevel{firstCell:vec2u,}
/** The texel address of one entry in the global 2D table. */
struct VsmTableCell{tableXY:vec2u,}
fn vsmTableCellPack(o:VsmTableCell)->u32{return (o.tableXY.x<<16u)|o.tableXY.y;}
fn vsmTableCellUnpack(p:u32)->VsmTableCell{return VsmTableCell(vec2u(highHalf(p),lowHalf(p)));}
fn vsmTableEntryAt(levelOffset:VsmTableLevel,level:u32,pageAddress:vec2u)->VsmTableCell{
 return VsmTableCell(levelOffset.firstCell+pageAddress);
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
`,
)

/**
 * A map's table in the global one, from its handle's origin and finest mip (`tableBlocks.ts`): mip
 * `mipLevel`'s first entry, and a page's. A table holds the mips from its finest on.
 */
export const VSM_TABLE_ORIGIN_WGSL = wgslBlock(
  'VSM_TABLE_ORIGIN_WGSL',
  [VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, lowHalf, highHalf],
  `
fn vsmTableLevelOrigin(h:VsmHandle,mipLevel:u32)->VsmTableLevel{
 let o=h.tableOrigin;
 return VsmTableLevel(vec2u(lowHalf(o),highHalf(o))+vsmMipTailOffset(mipLevel,h.finestMip));
}
fn vsmTableEntryOf(h:VsmHandle,level:u32,pageAddress:vec2u)->VsmTableCell{
 return vsmTableEntryAt(vsmTableLevelOrigin(h,level),level,pageAddress);
}
`,
)

/** Page lookups, through the module's `vsmPageTableLoad(index:u32)->u32` (`vsmBindingsWgsl`). */
export const VSM_PAGE_LOOKUP_WGSL = wgslBlock(
  'VSM_PAGE_LOOKUP_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL],
  `
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
 r.coarserLevels=e.coarserLevels+finestMip;
 r.mapTexelPos=mapUvAt*f32(vsmTexelsAtLevel(r.coarserLevels));
 r.mapTexelXY=vec2u(r.mapTexelPos);
 r.poolTexel=e.physicalAddress*VSM_PAGE_TEXELS+(r.mapTexelXY&vec2u(VSM_PAGE_TEXEL_MASK));
 return r;
}
`,
)

/**
 * The shared structs. Their WGSL storage layout is the host's stride:
 * VsmPoolPageInfo 24 bytes (flags 0, lastWantedStamp 4, mapId 8,
 * mipLevel 12, pageAddress 16), VsmNextMap 16 bytes (flags 0, nextMapId 4,
 * pageShift 8).
 */
export const VSM_STRUCTS_WGSL = wgslBlock(
  'VSM_STRUCTS_WGSL',
  [VSM_CONSTANTS_WGSL],
  `
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
`,
)
