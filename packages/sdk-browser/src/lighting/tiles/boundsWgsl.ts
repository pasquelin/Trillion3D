import { DEPTH_CLEAR, DEPTH_NEAR } from '../../camera/depthConvention.ts';

/**
 * The tile's depth bounds, one atomic per thread: what every device runs. Positive floats order
 * as their bits, so the extremes are the bits' extremes.
 */
const ATOMIC_DEPTH_BOUNDS = ` if(inside){
  if(z>${DEPTH_CLEAR}.0){
   atomicMax(&nearest,bitcast<u32>(z));
   atomicMin(&farthest,bitcast<u32>(z));
   atomicStore(&covered,1u);
  }else{
   atomicStore(&skyward,1u);
  }
 }`;
/**
 * The same bounds reduced in each subgroup first: one atomic per subgroup and per word, not one
 * per thread. A maximum and a minimum are exact in any order, so the words written are those of
 * `ATOMIC_DEPTH_BOUNDS`, to the bit. Every thread takes part — the reductions sit in uniform
 * control flow —, a thread outside the image with the neutral values.
 */
const SUBGROUP_DEPTH_BOUNDS = ` let lit=inside&&z>${DEPTH_CLEAR}.0;
 let near=subgroupMax(select(0u,bitcast<u32>(z),lit));
 let far=subgroupMin(select(0xffffffffu,bitcast<u32>(z),lit));
 let anyLit=subgroupAny(lit);let anySky=subgroupAny(inside&&!lit);
 if(subgroupElect()){
  if(anyLit){atomicMax(&nearest,near);atomicMin(&farthest,far);atomicStore(&covered,1u);}
  if(anySky){atomicStore(&skyward,1u);}
 }`;

/** The statements that fold a thread's depth `z` (`inside` the image) into the tile's bounds. */
export const tileDepthBoundsWgsl = (subgroups: boolean) =>
  subgroups ? SUBGROUP_DEPTH_BOUNDS : ATOMIC_DEPTH_BOUNDS;

/**
 * The tile's corner table, its opaque slice's two depth planes and the slice tests, beside the
 * tile's boxes and column (`./shader.ts`): sixteen threads de-project the corners, one each,
 * thread zero builds the bounds from them, every thread reads them. A light is kept in a slice
 * only if its range sphere meets both the slice's box and its planes: the planes are the tile's
 * own frustum, much tighter than a box once the tile is seen from above or at a slant.
 * `oracles/browser/gpuLightTileColumnOracle.ts` ports it line by line.
 */
export const TILE_BOUNDS_WGSL = `/** The opaque slice's front and back depth planes, facing each other: with the column's four
 *  sides, the six planes of the tile's frustum between its two depths. */
var<workgroup> slab:array<vec4f,2>;
/** The tile's corners, \`corners[row*4+corner]\`: one row per depth — the near plane, the
 *  column's depth, the tile's front, its back —, the corner's bit 0 the right edge, bit 1 the
 *  bottom. */
const NEAR_ROW:u32=0u;
const DEEP_ROW:u32=1u;
const FRONT_ROW:u32=2u;
const BACK_ROW:u32=3u;
var<workgroup> corners:array<vec3f,16>;
fn unproject(ndc:vec3f)->vec3f{
 let point=view.inverseViewProjection*vec4f(ndc,1.0);
 return point.xyz/point.w;
}
/** World position of a tile corner — bit 0 picks the right edge, bit 1 the bottom — at depth z. */
fn tileCorner(tile:vec2u,corner:u32,z:f32)->vec3f{
 let size=view.viewport.xy;
 let x=select(f32(tile.x*TILE_SIZE)/size.x,min(f32((tile.x+1u)*TILE_SIZE)/size.x,1.0),(corner&1u)!=0u);
 let y=select(f32(tile.y*TILE_SIZE)/size.y,min(f32((tile.y+1u)*TILE_SIZE)/size.y,1.0),(corner&2u)!=0u);
 return unproject(vec3f(x*2.0-1.0,1.0-y*2.0,z));
}
/** Thread \`lane\` below 16 de-projects its corner: the corners of the rows are independent,
 *  so sixteen threads do at once what thread zero did one after the other, to the same bits. */
fn tileCornerOfLane(tile:vec2u,lane:u32,front:f32,back:f32){
 if(lane<16u){
  let depths=array<f32,4>(${DEPTH_NEAR}.0,COLUMN_DEPTH,front,back);
  corners[lane]=tileCorner(tile,lane%4u,depths[lane/4u]);
 }
}
/** The opaque slice's depth planes, after \`tileColumn\`: a plane of one depth is parallel to
 *  the near plane, so both take its normal — read from corners spread across the column, never
 *  from three corners a tile apart, which f32 rounds to any direction far from the world
 *  origin — through the tile's corner at their depth, facing each other. */
fn tileSlab(){
 let away=column[4].xyz;
 slab[0]=vec4f(away,-dot(away,corners[FRONT_ROW*4u]));
 slab[1]=vec4f(-away,dot(away,corners[BACK_ROW*4u]));
}
/** A sphere is out of a plane only when wholly behind it by more than the rounding of the
 *  plane's own terms: the margin keeps the test conservative, so a light it drops meets no
 *  pixel of the slice and its term would have been an exact zero. */
fn sphereInFront(plane:vec4f,centre:vec3f,radius:f32)->bool{
 let side=dot(plane.xyz,centre);
 return side+plane.w>=-(radius+1e-5*(abs(side)+abs(plane.w))+1e-4);
}
fn sphereInSides(centre:vec3f,radius:f32)->bool{
 for(var i=0u;i<4u;i++){if(!sphereInFront(column[i],centre,radius)){return false;}}
 return true;
}
/** The opaque slice as a frustum: the column's four sides, then its two depth planes. */
fn sphereTouchesOpaqueSlice(centre:vec3f,radius:f32)->bool{
 return sphereTouchesBox(opaqueBox,centre,radius)&&sphereInSides(centre,radius)
  &&sphereInFront(slab[0],centre,radius)&&sphereInFront(slab[1],centre,radius);
}
/** The blend slice of a tile with no sky pixel: the column's sides and near plane, closed at the
 *  farthest opaque by the opaque slice's back plane. */
fn sphereTouchesBlendSlice(centre:vec3f,radius:f32)->bool{
 return sphereTouchesBox(blendBox,centre,radius)&&sphereInSides(centre,radius)
  &&sphereInFront(column[4],centre,radius)&&sphereInFront(slab[1],centre,radius);
}`;
