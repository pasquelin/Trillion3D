import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR,
  GLOBAL_DISTANCE_FIELD_PAGE_GROUP_NUM,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { unorm8 } from '../../../../math/src/wgsl/color.ts'
import { ATLAS_OFFSET_WGSL } from './atlasFetchWgsl.ts'
import { CLIP_BLOCK, CLIP_FLAG_PARENT, CONTROL } from './clipmapBlock.ts'

/**
 * WHAT THE PASSES OF THE GLOBAL DISTANCE FIELD SHARE: the clipmap's block, the words of a page table
 * and of a page tile, the way a page of the grid finds its place in the page table and its cell of the
 * culling grid its header, and the walk of the placements of that cell (`objectTileWalk`).
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
  CULL_FACTOR: GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR,
  FLAG_PARENT: CLIP_FLAG_PARENT,
}

const CLIP_STRUCT_WGSL = wgslBlock('CLIP_STRUCT_WGSL', [], `\n${CLIP_BLOCK.wgsl}`)

/** The shared declarations, the clipmap's block bound at `binding` of `group`. */
export function clipmapCommonWgsl(group: number, binding: number) {
  return wgslBlock(
    `CLIPMAP_COMMON_WGSL ${group} ${binding}`,
    [CLIP_STRUCT_WGSL, ATLAS_OFFSET_WGSL],
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
fn unpackTile(packed:u32)->vec3u{return vec3u(packed&0xFFu,(packed>>8u)&0xFFu,(packed>>16u)&0xFFu);}
fn packTile(grid:vec3u)->u32{return grid.x|(grid.y<<8u)|(grid.z<<16u);}
fn pageTableCoord(grid:vec3u)->vec3i{
 let centre=vec3f(grid)*clip.pageToPageScale+clip.pageToPageBias;
 let uv=fract(centre*clip.uvAddMul.w+clip.uvAddMul.xyz);
 let pages=vec3f(clip.pageGrid);
 return vec3i(clamp(saturate(uv)*pages,vec3f(0.0),pages-1.0))+vec3i(0,0,i32(clip.offsetZ));
}
/** The word of the culling grid where the cell of the page \`grid\` begins: its count of placements, then the
 *  first of them in the list. */
fn cullCellHeader(grid:vec3u)->u32{
 let cell=grid/vec3u(CULL_FACTOR);
 return clip.cullHeader+((cell.z*clip.cullGrid.y+cell.y)*clip.cullGrid.x+cell.x)*2u;
}`,
  )
}

/** The distance of the voxel `texel` of the page `parent`, the page of the static clipmap under the one composited, the
 *  atlas a buffer of bytes: the program binds it as `gdfPageAtlas` and declares the clipmap's block (`clipmapCommonWgsl`). */
export const PARENT_DISTANCE_BUFFER_WGSL = wgslBlock(
  'PARENT_DISTANCE_BUFFER_WGSL',
  [unorm8],
  `fn parentDistance(parent:GdfPage,texel:vec3u)->f32{
 let at=parent.index*512u+(texel.z*8u+texel.y)*8u+texel.x;
 let unit=unorm8(gdfPageAtlas[at>>2u],at&3u);
 return (unit*2.0-1.0)*clip.influenceRadius;
}`,
)

/** The same over the atlas as a storage texture: the program binds it as `gdfAtlas`, readable. */
export const PARENT_DISTANCE_TEXTURE_WGSL = wgslBlock(
  'PARENT_DISTANCE_TEXTURE_WGSL',
  [],
  `fn parentDistance(parent:GdfPage,texel:vec3u)->f32{
 let unit=textureLoad(gdfAtlas,vec3i(gdfAtlasOffset(parent.index)*GDF_PAGE_IN_ATLAS+texel)).x;
 return (unit*2.0-1.0)*clip.influenceRadius;
}`,
)

/** The placements a group lists at a time: the room of `tileObjects`. */
const TILE_OBJECTS = 511

/** The workgroup memory of the walk of a cell's placements (`objectTileWalk`), for a group of 64 threads. */
export const OBJECT_TILE_DECLS_WGSL = wgslBlock(
  'OBJECT_TILE_DECLS_WGSL',
  [],
  `const TILE_OBJECTS:u32=${TILE_OBJECTS}u;
var<workgroup> tileObjects:array<u32,${TILE_OBJECTS}>;
var<workgroup> tileCount:atomic<u32>;
var<workgroup> cellObjects:u32;`,
)

/**
 * THE WALK OF THE PLACEMENTS OF A PAGE'S CELL OF THE CULLING GRID, one text for the passes that visit
 * them (`composeWgsl.ts`, `coverageWgsl.ts`, `objectGridWgsl.ts`), in a group of 64 threads (`thread`)
 * over the page `pageGrid`, with the culling grid bound as `cullGrid` and the memory of
 * `OBJECT_TILE_DECLS_WGSL`: the cell's header read by the group's first thread — `leader` more
 * statements of it —, then the placements taken `TILE_OBJECTS` at a time: each thread asks `keep`, an
 * expression of a placement's bounds `bounds`, of the placements it takes, those kept are listed for the
 * group, and `each` runs, for every thread, over each listed placement `object`. A barrier ends each
 * round, so a list is never rewritten while a thread still reads it.
 */
export function objectTileWalk(walk: { leader?: string; keep: string; each: string }) {
  return ` let header=cullCellHeader(pageGrid);
 if(thread==0u){
  cellObjects=cullGrid[header];${walk.leader ?? ''}
 }
 let objects=workgroupUniformLoad(&cellObjects);
 let start=cullGrid[header+1u];
 for(var first=0u;first<objects;first+=TILE_OBJECTS){
  let last=first+min(objects-first,TILE_OBJECTS);
  if(thread==0u){atomicStore(&tileCount,0u);}
  workgroupBarrier();
  for(var k=first+thread;k<last;k+=64u){
   let object=cullGrid[clip.cullArray+start+k];
   let bounds=loadDfObjectBounds(object);
   if(${walk.keep}){tileObjects[atomicAdd(&tileCount,1u)]=object;}
  }
  workgroupBarrier();
  let listed=atomicLoad(&tileCount);
  for(var k=0u;k<listed;k++){
   let object=tileObjects[k];
${walk.each}
  }
  workgroupBarrier();
 }`
}
