import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DEPTH_CLEAR, DEPTH_NEAR } from '../../camera/depthConvention.ts';
import { directLightWgsl } from '../direct/lightWgsl.ts';
import { TILE_BOUNDS_WGSL, tileDepthBoundsWgsl } from './boundsWgsl.ts';
import { tileCompactResetWgsl, tileCompactStatementsWgsl, tileCompactWgsl } from './compactWgsl.ts';

/**
 * Light lists per 16 × 16 pixel screen tile. One workgroup per tile: the 256 threads reduce the
 * tile's min and max depth, sixteen de-project its corners, thread zero derives its world
 * bounds from them, then the threads compact the lights that reach it into its lists, in
 * batches of 256 lights, and past its list into the view's pool (`./compactWgsl.ts`, #849).
 *
 * **The masks and the light array follow the light count.** A scene of at most `TILE_LIGHTS`
 * lights runs the narrow pass: masks of one batch of that many lights, a light array that long,
 * no batch loop and no pool — no tile can pass its list. A larger scene runs the wide one
 * (`./tiles.ts`).
 *
 * **Two lists per tile, two depth slices.** The opaque list covers the slice between the tile's
 * two depths — its box and the six planes of the tile's frustum —, and deferred resolve loses
 * neither a light nor a millisecond. The blend list covers what lies in front of the tile's
 * background: a blend surface is drawn **in front of** its pixel's opaque, and a box that starts
 * at its depth would strip declared lights. Where every pixel has an opaque behind it, that is
 * the slice from the near plane to the farthest opaque, cut by the same planes. Where a pixel
 * sees the sky, a blend surface may stand at any distance in front of it — foliage against the
 * sky —, so the slice is the tile's whole column: bounded across by its four side planes and in
 * front by the near plane, unbounded in depth. One pass, one depth reduce, two compacts.
 *
 * The pass works in the frame of the eye rounded to f32 (`tileViewInverse`, `./tileFrame.ts`): its
 * corners and planes are unprojected there, and a light's centre is brought there by one
 * subtraction.
 *
 * Depth is REVERSE-Z (`../../camera/depthConvention.ts`): nearest is GREATEST, background is
 * zero, and the far plane is infinite — the background has no depth to unproject, so the
 * column's planes are read at a finite depth, which gives the same planes at any depth.
 */
const lightTilesShader = (subgroups: boolean, narrow: boolean) => {
  // Mask words of a batch: one bit per light, a thread per light, the workgroup wide at most.
  const words = (narrow ? LIGHT_SETTINGS.tileLights : LIGHT_SETTINGS.tileSize ** 2) / 32;
  return `${subgroups ? 'enable subgroups;' : ''}
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,origin:vec4f,}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var<uniform> view:TileView;
@group(0) @binding(2) var<storage,read> lights:DirectLights;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
${directLightWgsl(narrow ? LIGHT_SETTINGS.tileLights : undefined)}
struct Box{lo:vec3f,hi:vec3f,}
/** Depth the column's planes are read at: any depth short of the background gives the same
 *  planes; a deep one spreads the corners apart, so the planes keep their precision far from
 *  the world origin. A numerical choice, independent of the scene. */
const COLUMN_DEPTH:f32=${DEPTH_NEAR / 1024};
var<workgroup> nearest:atomic<u32>;
var<workgroup> farthest:atomic<u32>;
var<workgroup> covered:atomic<u32>;
var<workgroup> skyward:atomic<u32>;
var<workgroup> opaqueBox:Box;
var<workgroup> blendBox:Box;
var<workgroup> column:array<vec4f,5>;
/** The light count, one bound for the whole workgroup. */
var<workgroup> lightCount:u32;
/** World box of the tile between two rows of corners: eight corners, never a radius. */
fn tileBox(front:u32,back:u32)->Box{
 var box=Box(corners[front*4u],corners[front*4u]);
 for(var corner=1u;corner<8u;corner++){
  let world=corners[select(front,back,(corner&4u)!=0u)*4u+(corner&3u)];
  box.lo=min(box.lo,world);
  box.hi=max(box.hi,world);
 }
 return box;
}
/** Plane through \`point\` along \`normal\`, turned so that \`inside\` is on its positive side. */
fn inwardPlane(normal:vec3f,point:vec3f,inside:vec3f)->vec4f{
 let n=normalize(normal);
 let facing=select(-n,n,dot(n,inside-point)>=0.0);
 return vec4f(facing,-dot(facing,point));
}
/** The tile's column from the near plane to infinity: four side planes, each through two
 *  neighbouring corner rays, and the near plane, all facing the column's inside. */
fn tileColumn(){
 let row=DEEP_ROW*4u; // the centre summed in the table's order, as before: the same bits
 let inside=(corners[row]+corners[row+1u]+corners[row+2u]+corners[row+3u])*0.25;
 for(var i=0u;i<4u;i++){
  let near=columnCorner(NEAR_ROW,i);
  let deep=columnCorner(DEEP_ROW,i);
  column[i]=inwardPlane(cross(columnCorner(DEEP_ROW,(i+1u)%4u)-deep,deep-near),near,inside);
 }
 let first=columnCorner(DEEP_ROW,0u);
 column[4]=inwardPlane(cross(columnCorner(DEEP_ROW,1u)-first,columnCorner(DEEP_ROW,3u)-first),columnCorner(NEAR_ROW,0u),inside);
}
fn sphereTouchesBox(box:Box,centre:vec3f,radius:f32)->bool{
 let outside=max(box.lo-centre,centre-box.hi);
 let clamped=max(outside,vec3f(0.0));
 return dot(clamped,clamped)<=radius*radius;
}
${TILE_BOUNDS_WGSL}
${tileCompactWgsl(words, !narrow)}
@compute @workgroup_size(${LIGHT_SETTINGS.tileSize},${LIGHT_SETTINGS.tileSize},1)
fn lightTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){
 let base=(tile.y*u32(view.viewport.z)+tile.x)*TILE_STRIDE;
 if(lane==0u){
  atomicStore(&nearest,0u);
  atomicStore(&farthest,0xffffffffu);
  atomicStore(&covered,0u);
  atomicStore(&skyward,0u);
  lightCount=${narrow ? `min(lights.count,TILE_LIGHTS)` : 'lights.count'};
 }
${tileCompactResetWgsl(words, !narrow)}
 workgroupBarrier();
 let pixel=vec2u(tile.x*TILE_SIZE+lane%TILE_SIZE,tile.y*TILE_SIZE+lane/TILE_SIZE);
 var z=${DEPTH_CLEAR}.0;
 let inside=pixel.x<u32(view.viewport.x)&&pixel.y<u32(view.viewport.y);
 if(inside){z=textureLoad(depth,vec2i(pixel),0);}
${tileDepthBoundsWgsl(subgroups)}
 workgroupBarrier();
 tileCornerOfLane(tile.xy,lane);
 workgroupBarrier();
 if(lane==0u&&lightCount>0u){ // no light, no bounds to test it against
  // The column's sides bound both slices: every tile builds it, before the depth planes.
  tileColumn();
  if(atomicLoad(&covered)==1u){
   opaqueBox=tileBox(FRONT_ROW,BACK_ROW);tileSlab();
   // A pixel that sees the sky has no back to its blend slice: the whole column, never a box.
   if(atomicLoad(&skyward)==0u){blendBox=tileBox(NEAR_ROW,BACK_ROW);}
  }
 }
 let count=workgroupUniformLoad(&lightCount);
 // What the tile's pixels saw, read once: the barrier above made it final.
 let hasOpaque=atomicLoad(&covered)==1u;
 let seesSky=atomicLoad(&skyward)==1u;
${tileCompactStatementsWgsl(words, !narrow)}
}`;
};

/** The wide pass as every device runs it: per-thread atomics, no feature asked. */
const LIGHT_TILES_SHADER = lightTilesShader(false, false);
/** The narrow pass, for a scene of at most `TILE_LIGHTS` lights. */
const LIGHT_TILES_NARROW_SHADER = lightTilesShader(false, true);
/** Each variant under its one label, at `subgroups + 2 * narrow`: the device granted
 *  `subgroups`, the scene holds at most `TILE_LIGHTS` lights. */
export const LIGHT_TILES_SHADERS = [
  ['LIGHT_TILES_SHADER', LIGHT_TILES_SHADER],
  ['LIGHT_TILES_SUBGROUP_SHADER', lightTilesShader(true, false)],
  ['LIGHT_TILES_NARROW_SHADER', LIGHT_TILES_NARROW_SHADER],
  ['LIGHT_TILES_NARROW_SUBGROUP_SHADER', lightTilesShader(true, true)],
] as const;
