import { PAGE_INFO_STRUCT_WGSL } from './pageWgsl.ts';
import { MATERIAL_CLASS_WGSL } from './materialClass.ts';
import { SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts';

/**
 * Material tiles: cluster's material classification (#1369). Each class pass drew a full-screen
 * triangle the material depth test refused everywhere but on its pixels, so an image of `K`
 * classes rasterised and depth-tested every pixel `K` times. A compute pass now reads the
 * visibility buffer once, marks in each screen tile the classes its pixels hold
 * (`materialClassOf`, the answer the material depth writes), and appends the tile to the list of
 * each; a class then draws, through one indirect draw, a quad per tile of its list only. The
 * fragments that pass the depth test are the same, shaded by the same code: only the pixels of
 * tiles a class has none of are no longer rasterised for it.
 *
 * A class with no list — past the first `MATERIAL_TILE_SLOTS` held, or not held at all — has
 * the slot `MATERIAL_TILE_SLOTS`: no pixel marks it, and it draws the full-screen triangle, as
 * before (`classTriangle`, `shadeDeclWgsl.ts`).
 */
const MATERIAL_TILE_SIZE = 32;
/** Tiles on one axis of `pixels`: `materialTilesX`'s count. */
export const materialTilesOn = (pixels: number) => Math.ceil(pixels / MATERIAL_TILE_SIZE);
export const MATERIAL_TILE_SLOTS = 64;
/** Lanes of a tile's workgroup per axis: a lane reads the tile's pixels that many apart. */
const LANES = 8;

const CONSTANTS_WGSL = `const MATERIAL_TILE_SIZE:u32=${MATERIAL_TILE_SIZE}u;
const MATERIAL_TILE_SLOTS:u32=${MATERIAL_TILE_SLOTS}u;
/** Tiles on a row of the image \`size\`: the dispatch's and the draw's one count. */
fn materialTilesX(size:vec2u)->u32{return (size.x+MATERIAL_TILE_SIZE-1u)/MATERIAL_TILE_SIZE;}
/** Where slot \`slot\`'s list starts in \`classTiles\`: the one layout the lists are written and read in. */
fn tileListStart(slot:u32)->u32{return slot*(arrayLength(&classTiles)/MATERIAL_TILE_SLOTS);}`;

/**
 * The class draws' vertex stage, in the resolve's module: quad corner `i` of tile `n` of the
 * class's list at the class depth — for a class with no list, corner `i` of the full-screen
 * triangle. The corners are whole pixels, shared by the neighbour tiles: no pixel centre lies on an
 * edge, none is covered twice.
 */
export const MATERIAL_TILE_DRAW_WGSL = `${CONSTANTS_WGSL}
@group(1) @binding(0) var<storage,read> classSlots:array<u32>;
@group(1) @binding(1) var<storage,read> classTiles:array<u32>;
/** Pixel corner \`i\` (0‥5, two triangles) of tile \`tile\` on a row of \`tilesX\`. */
fn materialTileCorner(tile:u32,i:u32,tilesX:u32)->vec2u{
 let x=(tile%tilesX+((0x32u>>i)&1u))*MATERIAL_TILE_SIZE;
 let y=(u32(tile/tilesX)+((0x2cu>>i)&1u))*MATERIAL_TILE_SIZE;
 return vec2u(x,y);
}
@vertex fn shade_tile_vs(@builtin(vertex_index) i:u32,@builtin(instance_index) n:u32)->@builtin(position) vec4f{
 let slot=classSlots[CLASS_KEY];
 if(slot>=MATERIAL_TILE_SLOTS){return classTriangle(i);}
 let pixel=vec2f(materialTileCorner(classTiles[tileListStart(slot)+n],i,materialTilesX(vec2u(uni.viewport))));
 return vec4f(pixel.x/uni.viewport.x*2.0-1.0,1.0-pixel.y/uni.viewport.y*2.0,CLASS_DEPTH,1.0);
}`;

/**
 * The classification, one workgroup per tile: each lane marks the slots of its pixels in two
 * words, the group ors them, then lane `s` appends the tile to slot `s`'s list when the tile holds
 * it. The first append of a slot writes its draw's vertex count; the pass's clear left the rest 0.
 * A pixel off the image is skipped by a branch, never by leaving the loop: a lane leaving it early
 * would put the barrier in non-uniform control flow, which WGSL refuses to compile.
 */
export const MATERIAL_TILES_SHADER = `${PAGE_INFO_STRUCT_WGSL}
${SHADE_UNI_WGSL}
@group(0) @binding(0) var vis:texture_2d<u32>;
@group(0) @binding(1) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(2) var<uniform> uni:ShadeUni;
@group(0) @binding(3) var<storage,read> classSlots:array<u32>;
@group(0) @binding(4) var<storage,read_write> classTiles:array<u32>;
@group(0) @binding(5) var<storage,read_write> tileDraws:array<atomic<u32>>;
${MATERIAL_CLASS_WGSL}
${CONSTANTS_WGSL}
var<workgroup> held:array<atomic<u32>,2>;
/** Slot of a pixel's class, \`MATERIAL_TILE_SLOTS\` for none: the background, a class the image
 *  does not hold, one past the slots. */
fn pixelSlot(id:u32)->u32{
 let key=materialClassOf(id);
 if(key==0u){return MATERIAL_TILE_SLOTS;}
 return classSlots[key-1u];
}
@compute @workgroup_size(${LANES},${LANES}) fn classify(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u,@builtin(local_invocation_index) index:u32){
 let size=vec2u(uni.viewport);
 var marks=vec2u(0u);
 for(var y=0u;y<MATERIAL_TILE_SIZE;y+=${LANES}u){for(var x=0u;x<MATERIAL_TILE_SIZE;x+=${LANES}u){
  let at=group.xy*MATERIAL_TILE_SIZE+lane.xy+vec2u(x,y);
  if(all(at<size)){
   let slot=pixelSlot(textureLoad(vis,vec2i(at),0).r);
   if(slot<MATERIAL_TILE_SLOTS){marks[slot>>5u]|=1u<<(slot&31u);}
  }
 }}
 if(marks.x!=0u){atomicOr(&held[0],marks.x);}
 if(marks.y!=0u){atomicOr(&held[1],marks.y);}
 workgroupBarrier();
 if(index>=MATERIAL_TILE_SLOTS||((atomicLoad(&held[index>>5u])>>(index&31u))&1u)==0u){return;}
 let at=atomicAdd(&tileDraws[index*4u+1u],1u);
 if(at==0u){atomicStore(&tileDraws[index*4u],6u);}
 classTiles[tileListStart(index)+at]=group.y*materialTilesX(size)+group.x;
}`;
