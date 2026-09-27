import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts';
import { TILE_BOUNDS_WGSL, tileDepthBoundsWgsl } from './boundsWgsl.ts';

const WORDS = LIGHT_SETTINGS.tileSize ** 2 / 32; // one mask bit per thread, a thread per light

/**
 * Light lists per 16 × 16 pixel screen tile. One workgroup per tile: the 256 threads reduce the
 * tile's min and max depth, thread zero derives the tile's world bounds, each thread tests one
 * light, then each kept thread writes its rank at the place the bit count before it names —
 * order stays increasing and determined, so the frame is too. Past 256 lights, batches of 256
 * write after what the batches before kept. Each list holds `TILE_LIGHTS` lights, its memory
 * bounded by the view; its count stays true, and a tile more lights reach walks them all.
 *
 * **Two lists per tile, two depth slices.** The opaque list covers the slice between the tile's
 * two depths, the tightest there is — its box and the six planes of the tile's frustum between
 * them —, and deferred resolve loses neither a light nor a millisecond. The blend list covers
 * what lies in front of the tile's background: a blend surface is drawn **in front of** its
 * pixel's opaque, and a box that starts at its depth would strip declared lights. Where every
 * pixel has an opaque behind it, that is the slice from the near plane to the farthest opaque,
 * its box cut by the same planes. Where a pixel sees the sky, a blend surface may stand at
 * any distance in front of it — foliage against the sky —, so the slice is the tile's whole
 * column: bounded across by its four side planes and in front by the near plane, unbounded in
 * depth. One pass, one depth reduce, two compacts.
 *
 * Depth is REVERSE-Z (`../../camera/depthConvention.ts`): nearest is GREATEST, background is
 * zero, and the far plane is infinite — the background has no depth to unproject, so the
 * column's planes are read at a finite depth, which gives the same planes at any depth.
 *
 * Where the device grants `subgroups`, `lightTilesShader(true)` reduces the depth bounds per
 * subgroup before its atomics: the same words, so the same lists.
 */
export const lightTilesShader = (subgroups: boolean) => `${subgroups ? 'enable subgroups;' : ''}
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var<uniform> view:TileView;
@group(0) @binding(2) var<storage,read> lights:DirectLights;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
${DIRECT_LIGHT_WGSL}
${TILE_BOUNDS_WGSL}
var<workgroup> nearest:atomic<u32>;
var<workgroup> farthest:atomic<u32>;
var<workgroup> covered:atomic<u32>;
var<workgroup> skyward:atomic<u32>;
/** One mask, two slices: the first ${WORDS} words are the opaque list's, the next those of
 *  the blend list. One rank function knows how to read them, indexed by the start of its
 *  slice — no pointer into workgroup memory, which not every device takes as a parameter. */
const OPAQUE_MASK:u32=0u;
const BLEND_MASK:u32=${WORDS}u;
var<workgroup> hits:array<atomic<u32>,${2 * WORDS}u>;
/** The light count, one bound for the whole workgroup, and what the batches before kept. */
var<workgroup> lightCount:u32;
var<workgroup> kept:vec2u;
/** Rank of a kept light: the number of kept bits before it in the same slice. */
fn rankBefore(mask:u32,lane:u32)->u32{
 let word=mask+lane/32u;
 var rank=0u;
 for(var before=mask;before<word;before++){rank=rank+countOneBits(atomicLoad(&hits[before]));}
 return rank+countOneBits(atomicLoad(&hits[word])&((1u<<(lane%32u))-1u));
}
fn maskHolds(mask:u32,lane:u32)->bool{
 return (atomicLoad(&hits[mask+lane/32u])&(1u<<(lane%32u)))!=0u;
}
/** Adds a full batch's totals to \`kept\` and clears its masks: thread zero, between batches. */
fn clearedKept(){
 kept+=vec2u(maskTotal(OPAQUE_MASK,${WORDS}u),maskTotal(BLEND_MASK,${WORDS}u));
 for(var word=0u;word<${2 * WORDS}u;word++){atomicStore(&hits[word],0u);}
}
/** Kept bits of a slice's first \`words\` mask words: those a batch's lights fill. */
fn maskTotal(mask:u32,words:u32)->u32{
 var total=0u;
 for(var w=0u;w<words;w++){total=total+countOneBits(atomicLoad(&hits[mask+w]));}
 return total;
}
@compute @workgroup_size(${LIGHT_SETTINGS.tileSize},${LIGHT_SETTINGS.tileSize},1)
fn lightTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&nearest,0u);
  atomicStore(&farthest,0xffffffffu);
  atomicStore(&covered,0u);
  atomicStore(&skyward,0u);
  lightCount=lights.count;kept=vec2u(0u);
 }
 if(lane<${2 * WORDS}u){atomicStore(&hits[lane],0u);}
 workgroupBarrier();
 let pixel=vec2u(tile.x*TILE_SIZE+lane%TILE_SIZE,tile.y*TILE_SIZE+lane/TILE_SIZE);
 var z=${DEPTH_CLEAR}.0;
 let inside=pixel.x<u32(view.viewport.x)&&pixel.y<u32(view.viewport.y);
 if(inside){z=textureLoad(depth,vec2i(pixel),0);}
${tileDepthBoundsWgsl(subgroups)}
 workgroupBarrier();
 tileCornerOfLane(tile.xy,lane,bitcast<f32>(atomicLoad(&nearest)),bitcast<f32>(atomicLoad(&farthest)));
 workgroupBarrier();
 if(lane==0u){
  // The column's sides bound both slices: every tile builds it, before the depth planes.
  tileColumn();
  if(atomicLoad(&covered)==1u){opaqueBox=tileBox(FRONT_ROW,BACK_ROW);tileSlab();}
  // A pixel that sees the sky has no back to its blend slice: the whole column, never a box.
  if(atomicLoad(&skyward)==0u){blendBox=tileBox(NEAR_ROW,BACK_ROW);}
 }
 let count=workgroupUniformLoad(&lightCount);
 let base=(tile.y*u32(view.viewport.z)+tile.x)*TILE_STRIDE;
 // Up to 256 lights, one batch: the barriers and the work of a single pass, no more.
 for(var first=0u;first<count;first+=${WORDS * 32}u){
  let index=first+lane;
  if(index<count){
   let light=lights.items[index];
   // A directional light reaches everywhere: no tile bound can reject it. The others are kept
   // only if their range sphere touches the slice.
   let sun=isSun(light);
   let centre=light.positionRange.xyz;
   let radius=light.positionRange.w;
   let bit=1u<<(lane%32u);
   if(atomicLoad(&covered)==1u&&(sun||sphereTouchesOpaqueSlice(centre,radius))){
    atomicOr(&hits[OPAQUE_MASK+lane/32u],bit);
   }
   var blendTouched=sun;
   if(!sun&&atomicLoad(&skyward)==1u){blendTouched=sphereTouchesColumn(centre,radius);}
   // No sky pixel: every pixel has an opaque, so the opaque slice's back plane exists.
   else if(!sun){blendTouched=sphereTouchesBlendSlice(centre,radius);}
   if(blendTouched){
    atomicOr(&hits[BLEND_MASK+lane/32u],bit);
   }
  }
  workgroupBarrier();
  // Parallel compact, each light at its rank after what the batches before kept: increasing
  // order, as a single-thread loop. A rank past TILE_LIGHTS is not written: that tile walks all.
  if(index<count&&maskHolds(OPAQUE_MASK,lane)){let at=kept.x+rankBefore(OPAQUE_MASK,lane);if(at<TILE_LIGHTS){tiles[base+TILE_OPAQUE_BASE+at]=index;}}
  if(index<count&&maskHolds(BLEND_MASK,lane)){let at=kept.y+rankBefore(BLEND_MASK,lane);if(at<TILE_LIGHTS){tiles[base+TILE_BLEND_BASE+at]=index;}}
  // Another batch follows: thread zero counts what this one kept, then clears its mask.
  if(first+${WORDS * 32}u<count){workgroupBarrier();if(lane==0u){clearedKept();}workgroupBarrier();}
 }
 let live=(count-(max(count,1u)-1u)/${WORDS * 32}u*${WORDS * 32}u+31u)/32u; // the last batch's words
 if(lane==0u){tiles[base]=kept.x+maskTotal(OPAQUE_MASK,live);tiles[base+1u]=kept.y+maskTotal(BLEND_MASK,live);}
}`;

/** The pass as every device runs it: per-thread atomics, no feature asked. */
export const LIGHT_TILES_SHADER = lightTilesShader(false);
