import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  GLOBAL_DISTANCE_FIELD_PAGE_GROUP_NUM,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { CLIP_BLOCK, CONTROL } from './clipmapBlock.ts'

/**
 * WHAT THE PASSES OF THE GLOBAL DISTANCE FIELD SHARE: the clipmap's block, the words of a page table
 * and of a page tile, and the way a page of the grid finds its place in the page table.
 *
 * A page table holds a word for each page of a clipmap, the clipmaps one above the other: the page's
 * index in the atlas in the low 24 bits, the top bit set where it carries coverage, all ones where no page
 * is allocated. A page tile is the page's place in its clipmap's grid, 8 bits an axis, in a word.
 * The tile of a page of the grid finds its word by the clipmap's scroll: its centre carried to the
 * volume's texture coordinate, wrapped, scaled to the pages.
 */

const COMMON = {
  GDF_PAGE: GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
  GDF_PAGE_IN_ATLAS: GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS,
  GDF_PAGE_GROUPS: GLOBAL_DISTANCE_FIELD_PAGE_GROUP_NUM,
  GDF_FREE_ALLOCATOR: CONTROL.freeAllocator,
  GDF_RETURN_ALLOCATOR: CONTROL.returnAllocator,
}

const CLIP_STRUCT_WGSL = wgslBlock('CLIP_STRUCT_WGSL', [], `\n${CLIP_BLOCK.wgsl}`)

/** The shared declarations, the clipmap's block bound at `binding` of `group`. */
export function clipmapCommonWgsl(group: number, binding: number) {
  return wgslBlock(
    `CLIPMAP_COMMON_WGSL ${group} ${binding}`,
    [CLIP_STRUCT_WGSL],
    `
${wgslConsts(COMMON)}
const GDF_INVALID_PAGE=0xFFFFFFFFu;
const GDF_COVERAGE_BIT=0x80000000u;
const GDF_PAGE_BORDER=0.5;
@group(${group}) @binding(${binding}) var<uniform> clip:DfClip;
struct GdfPage{index:u32,valid:bool,coverage:bool}
fn packGdfPage(p:GdfPage)->u32{
 if(!p.valid){return GDF_INVALID_PAGE;}
 return (p.index&0x00FFFFFFu)|select(0u,GDF_COVERAGE_BIT,p.coverage);
}
fn unpackGdfPage(packed:u32)->GdfPage{
 return GdfPage(packed&0x00FFFFFFu,packed<GDF_INVALID_PAGE,(packed&GDF_COVERAGE_BIT)!=0u);
}
fn gdfAtlasOffset(index:u32)->vec3u{return vec3u(index&0x7Fu,(index>>7u)&0x7Fu,index>>14u);}
fn unpackTile(packed:u32)->vec3u{return vec3u(packed&0xFFu,(packed>>8u)&0xFFu,(packed>>16u)&0xFFu);}
fn packTile(grid:vec3u)->u32{return grid.x|(grid.y<<8u)|(grid.z<<16u);}
fn pageTableCoord(grid:vec3u)->vec3i{
 let centre=vec3f(grid)*clip.pageToPageScale+clip.pageToPageBias;
 let uv=fract(centre*clip.uvAddMul.w+clip.uvAddMul.xyz);
 let pages=vec3f(clip.pageGrid);
 return vec3i(clamp(saturate(uv)*pages,vec3f(0.0),pages-1.0))+vec3i(0,0,i32(clip.offsetZ));
}`,
  )
}
