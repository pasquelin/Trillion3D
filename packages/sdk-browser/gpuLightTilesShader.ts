import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import { DEPTH_CLEAR, DEPTH_NEAR } from './depthConvention.ts';
import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';

const WORDS = Math.ceil(LIGHT_SETTINGS.maxLights / 32);

/**
 * Light lists per 16 × 16 pixel screen tile. One workgroup per tile: the 256 threads reduce the
 * tile's min and max depth, thread zero derives the tile's world bounding boxes, each thread
 * tests one light, then each kept thread writes its rank at the place the bit count before it
 * names — order stays increasing and determined, so the frame is too. No unbounded loop: each
 * list stops at `maxLightsPerTile`, and the requested count is written next to the kept count.
 *
 * **Two lists per tile, two depth slices.** The opaque list covers the slice between the tile's
 * two depths, the tightest there is, and deferred resolve loses neither a light nor a
 * millisecond. The blend list covers the slice from the near plane to the opaque background,
 * and the whole world where no opaque covers the tile: a blend surface is drawn **in front of**
 * its pixel's opaque, and a box that starts at its depth would strip declared lights — foliage
 * in front of the sky would keep none. One pass, one depth reduce, two compacts.
 *
 * Depth is REVERSE-Z (`depthConvention.ts`): nearest is GREATEST, background is zero, and the
 * far plane is infinite — a tile without opaque therefore has no back bound to unproject, and
 * takes the whole world rather than a point at infinity.
 */
export const LIGHT_TILES_SHADER = `
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,counts:vec4f,}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var<uniform> view:TileView;
@group(0) @binding(2) var<storage,read> lights:DirectLights;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
${DIRECT_LIGHT_WGSL}
struct Box{lo:vec3f,hi:vec3f,}
var<workgroup> nearest:atomic<u32>;
var<workgroup> farthest:atomic<u32>;
var<workgroup> covered:atomic<u32>;
/** One mask, two slices: the first ${WORDS} words are the opaque list's, the next those of
 *  the blend list. One rank function knows how to read them, indexed by the start of its
 *  slice — no pointer into workgroup memory, which not every device takes as a parameter. */
const OPAQUE_MASK:u32=0u;
const BLEND_MASK:u32=${WORDS}u;
var<workgroup> hits:array<atomic<u32>,${2 * WORDS}u>;
var<workgroup> opaqueBox:Box;
var<workgroup> blendBox:Box;
fn unproject(ndc:vec3f)->vec3f{
 let point=view.inverseViewProjection*vec4f(ndc,1.0);
 return point.xyz/point.w;
}
/** World box of the tile between two depths: eight corners, never a radius. */
fn tileBox(tile:vec2u,front:f32,back:f32)->Box{
 let size=view.viewport.xy;
 let x0=f32(tile.x*TILE_SIZE)/size.x*2.0-1.0;
 let x1=min(f32((tile.x+1u)*TILE_SIZE)/size.x,1.0)*2.0-1.0;
 let y0=1.0-f32(tile.y*TILE_SIZE)/size.y*2.0;
 let y1=1.0-min(f32((tile.y+1u)*TILE_SIZE)/size.y,1.0)*2.0;
 var box:Box;
 box.lo=vec3f(1e30);
 box.hi=vec3f(-1e30);
 for(var corner=0u;corner<8u;corner++){
  let px=select(x0,x1,(corner&1u)!=0u);
  let py=select(y0,y1,(corner&2u)!=0u);
  let pz=select(front,back,(corner&4u)!=0u);
  let world=unproject(vec3f(px,py,pz));
  box.lo=min(box.lo,world);
  box.hi=max(box.hi,world);
 }
 return box;
}
fn sphereTouchesBox(box:Box,centre:vec3f,radius:f32)->bool{
 let outside=max(box.lo-centre,centre-box.hi);
 let clamped=max(outside,vec3f(0.0));
 return dot(clamped,clamped)<=radius*radius;
}
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
  for(var word=0u;word<${2 * WORDS}u;word++){atomicStore(&hits[word],0u);}
 }
 workgroupBarrier();
 let pixel=vec2u(tile.x*TILE_SIZE+lane%TILE_SIZE,tile.y*TILE_SIZE+lane/TILE_SIZE);
 if(pixel.x<u32(view.viewport.x)&&pixel.y<u32(view.viewport.y)){
  let z=textureLoad(depth,vec2i(pixel),0);
  if(z>${DEPTH_CLEAR}.0){
   atomicMax(&nearest,bitcast<u32>(z));
   atomicMin(&farthest,bitcast<u32>(z));
   atomicStore(&covered,1u);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  if(atomicLoad(&covered)==1u){
   let front=bitcast<f32>(atomicLoad(&nearest));
   let back=bitcast<f32>(atomicLoad(&farthest));
   opaqueBox=tileBox(tile.xy,front,back);
   blendBox=tileBox(tile.xy,${DEPTH_NEAR}.0,back);
  }else{
   // Nothing to unproject at the back: the whole world, where no light is rejected.
   var whole:Box;whole.lo=vec3f(-1.0e30);whole.hi=vec3f(1.0e30);
   opaqueBox=whole;blendBox=whole;
  }
 }
 workgroupBarrier();
 let count=min(lights.count,MAX_LIGHTS);
 if(lane<count){
  let light=lights.items[lane];
  // A directional light reaches everywhere: no tile box can reject it. The others are kept
  // only if their range sphere touches the slice's world box.
  let sun=isSun(light);
  let bit=1u<<(lane%32u);
  if(atomicLoad(&covered)==1u&&(sun||sphereTouchesBox(opaqueBox,light.positionRange.xyz,light.positionRange.w))){
   atomicOr(&hits[OPAQUE_MASK+lane/32u],bit);
  }
  if(sun||sphereTouchesBox(blendBox,light.positionRange.xyz,light.positionRange.w)){
   atomicOr(&hits[BLEND_MASK+lane/32u],bit);
  }
 }
 workgroupBarrier();
 // Parallel compact: each thread writes its light at its rank, so each list carries the same
 // light ranks in the same increasing order as the single-thread loop it replaces.
 let base=(tile.y*u32(view.viewport.z)+tile.x)*TILE_STRIDE;
 if(lane<count&&maskHolds(OPAQUE_MASK,lane)){
  let rank=rankBefore(OPAQUE_MASK,lane);
  if(rank<MAX_TILE_LIGHTS){tiles[base+4u+rank]=lane;}
 }
 if(lane<count&&maskHolds(BLEND_MASK,lane)){
  let rank=rankBefore(BLEND_MASK,lane);
  if(rank<MAX_TILE_LIGHTS){tiles[base+TILE_BLEND_BASE+rank]=lane;}
 }
 if(lane==0u){
  let requested=maskTotal(OPAQUE_MASK);
  let blendRequested=maskTotal(BLEND_MASK);
  tiles[base]=min(requested,MAX_TILE_LIGHTS);
  tiles[base+1u]=requested;
  tiles[base+2u]=min(blendRequested,MAX_TILE_LIGHTS);
  tiles[base+3u]=blendRequested;
 }
}`;
