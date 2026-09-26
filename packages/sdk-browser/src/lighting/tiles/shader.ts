import { LIGHT_SETTINGS, SCENE_LIGHT_STEP } from '../../../../sdk-core/src/index.ts';
import { DEPTH_CLEAR, DEPTH_NEAR } from '../../camera/depthConvention.ts';
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts';
import { TILE_BOUNDS_WGSL } from './boundsWgsl.ts';

/** Threads of a tile's workgroup: the lights one batch tests, one each. */
const LANES = LIGHT_SETTINGS.tileSize ** 2;
const WORDS = LANES / SCENE_LIGHT_STEP;

/**
 * Light lists per 16 × 16 pixel screen tile. One workgroup per tile: the 256 threads reduce the
 * tile's min and max depth, thread zero derives the tile's world bounds, each thread tests one
 * light, then each kept thread writes its rank at the place the bit count before it names —
 * order stays increasing and determined, so the frame is too. Past 256 lights the scene's lights
 * are tested in batches of 256, each batch's ranks following the lists the batches before it
 * wrote. Each list has room for every slot of the light table (`DirectLights.capacity`): no tile
 * drops a light, however many touch it, and each pixel walks only the lights reaching its tile.
 *
 * **Two lists per tile, two depth slices.** The opaque list covers the slice between the tile's
 * two depths, the tightest there is, and deferred resolve loses neither a light nor a
 * millisecond. The blend list covers what lies in front of the tile's background: a blend
 * surface is drawn **in front of** its pixel's opaque, and a box that starts at its depth would
 * strip declared lights. Where every pixel has an opaque behind it, that is the box from the
 * near plane to the farthest opaque. Where a pixel sees the sky, a blend surface may stand at
 * any distance in front of it — foliage against the sky —, so the slice is the tile's whole
 * column: bounded across by its four side planes and in front by the near plane, unbounded in
 * depth. One pass, one depth reduce, two compacts.
 *
 * Depth is REVERSE-Z (`../../camera/depthConvention.ts`): nearest is GREATEST, background is
 * zero, and the far plane is infinite — the background has no depth to unproject, so the
 * column's planes are read at a finite depth, which gives the same planes at any depth.
 */
export const LIGHT_TILES_SHADER = `
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var<uniform> view:TileView;
@group(0) @binding(2) var<storage,read> lights:DirectLights;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
${DIRECT_LIGHT_WGSL}
struct Box{lo:vec3f,hi:vec3f,}
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
var<workgroup> opaqueBox:Box;
var<workgroup> blendBox:Box;
var<workgroup> column:array<vec4f,5>;
/** The scene's light count, read once for the whole workgroup: the batch loop's uniform bound. */
var<workgroup> lightCount:u32;
/** What the batches before this one kept, in each list. */
var<workgroup> opaqueKept:u32;
var<workgroup> blendKept:u32;
${TILE_BOUNDS_WGSL}
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
fn maskTotal(mask:u32)->u32{
 var total=0u;
 for(var w=0u;w<${WORDS}u;w++){total=total+countOneBits(atomicLoad(&hits[mask+w]));}
 return total;
}
@compute @workgroup_size(${LIGHT_SETTINGS.tileSize},${LIGHT_SETTINGS.tileSize},1)
fn lightTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&nearest,0u);
  atomicStore(&farthest,0xffffffffu);
  atomicStore(&covered,0u);
  atomicStore(&skyward,0u);
  lightCount=lights.count;
  opaqueKept=0u;
  blendKept=0u;
 }
 workgroupBarrier();
 let pixel=vec2u(tile.x*TILE_SIZE+lane%TILE_SIZE,tile.y*TILE_SIZE+lane/TILE_SIZE);
 if(pixel.x<u32(view.viewport.x)&&pixel.y<u32(view.viewport.y)){
  let z=textureLoad(depth,vec2i(pixel),0);
  if(z>${DEPTH_CLEAR}.0){
   atomicMax(&nearest,bitcast<u32>(z));
   atomicMin(&farthest,bitcast<u32>(z));
   atomicStore(&covered,1u);
  }else{
   atomicStore(&skyward,1u);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  let back=bitcast<f32>(atomicLoad(&farthest));
  if(atomicLoad(&covered)==1u){opaqueBox=tileBox(tile.xy,bitcast<f32>(atomicLoad(&nearest)),back);}
  // A pixel that sees the sky has no back to its blend slice: the whole column, never a box.
  if(atomicLoad(&skyward)==1u){tileColumn(tile.xy);}else{blendBox=tileBox(tile.xy,${DEPTH_NEAR}.0,back);}
 }
 let count=workgroupUniformLoad(&lightCount);
 let capacity=lights.capacity;
 let base=(tile.y*u32(view.viewport.z)+tile.x)*tileStride(capacity);
 for(var first=0u;first<count;first+=${LANES}u){
  if(lane<${2 * WORDS}u){atomicStore(&hits[lane],0u);}
  workgroupBarrier();
  let index=first+lane;
  if(index<count){
   let light=lights.items[index];
   // A directional light reaches everywhere: no tile bound can reject it. The others are kept
   // only if their range sphere touches the slice.
   let sun=isSun(light);
   let centre=light.positionRange.xyz;
   let radius=light.positionRange.w;
   let bit=1u<<(lane%32u);
   if(atomicLoad(&covered)==1u&&(sun||sphereTouchesBox(opaqueBox,centre,radius))){
    atomicOr(&hits[OPAQUE_MASK+lane/32u],bit);
   }
   var blendTouched=sun;
   if(!sun&&atomicLoad(&skyward)==1u){blendTouched=sphereTouchesColumn(centre,radius);}
   else if(!sun){blendTouched=sphereTouchesBox(blendBox,centre,radius);}
   if(blendTouched){
    atomicOr(&hits[BLEND_MASK+lane/32u],bit);
   }
  }
  workgroupBarrier();
  // Parallel compact: each thread writes its light at its rank after what the batches before
  // kept, so each list carries the light ranks in increasing order, as a single-thread loop
  // would. The rank is below \`count\`, itself at most the table's slots, so it has its place.
  if(index<count&&maskHolds(OPAQUE_MASK,lane)){
   tiles[base+TILE_OPAQUE_BASE+opaqueKept+rankBefore(OPAQUE_MASK,lane)]=index;
  }
  if(index<count&&maskHolds(BLEND_MASK,lane)){
   tiles[base+tileBlendBase(capacity)+blendKept+rankBefore(BLEND_MASK,lane)]=index;
  }
  workgroupBarrier();
  if(lane==0u){
   opaqueKept+=maskTotal(OPAQUE_MASK);
   blendKept+=maskTotal(BLEND_MASK);
  }
  workgroupBarrier();
 }
 if(lane==0u){
  tiles[base]=opaqueKept;
  tiles[base+1u]=blendKept;
 }
}`;
