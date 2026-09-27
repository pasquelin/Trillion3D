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
 * A tile's world bounds: sixteen threads de-project its corners at its four depths, one corner
 * each, then thread zero builds from them, and every thread reads, the boxes of its two slices,
 * the column's five planes and the opaque slice's two depth planes. A light is kept in a slice
 * only if its range sphere meets both the slice's box and its planes: the planes are the tile's
 * own frustum, much tighter than a box once the tile is seen from above or at a slant.
 * `oracles/browser/gpuLightTileColumnOracle.ts` ports it line by line.
 */
export const TILE_BOUNDS_WGSL = `
struct Box{lo:vec3f,hi:vec3f,}
/** Depth the column's planes are read at: any depth short of the background gives the same
 *  planes; a deep one spreads the corners apart, so the planes keep their precision far from
 *  the world origin. A numerical choice, independent of the scene. */
const COLUMN_DEPTH:f32=${DEPTH_NEAR / 1024};
var<workgroup> opaqueBox:Box;
var<workgroup> blendBox:Box;
/** The column's four sides, then its near plane, all facing its inside. */
var<workgroup> column:array<vec4f,5>;
/** The opaque slice's front and back depth planes, facing each other: with the column's four
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
/** World box of the tile between two rows of corners: eight corners, never a radius. */
fn tileBox(front:u32,back:u32)->Box{
 var box:Box;
 box.lo=vec3f(1e30);
 box.hi=vec3f(-1e30);
 for(var corner=0u;corner<8u;corner++){
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
 var order=array<u32,4>(0u,1u,3u,2u);
 var near:array<vec3f,4>;
 var deep:array<vec3f,4>;
 var inside=vec3f(0.0);
 for(var i=0u;i<4u;i++){
  near[i]=corners[NEAR_ROW*4u+order[i]];
  deep[i]=corners[DEEP_ROW*4u+order[i]];
  inside+=deep[i]*0.25;
 }
 for(var i=0u;i<4u;i++){
  column[i]=inwardPlane(cross(deep[(i+1u)%4u]-deep[i],deep[i]-near[i]),near[i],inside);
 }
 column[4]=inwardPlane(cross(deep[1]-deep[0],deep[3]-deep[0]),near[0],inside);
}
/** The opaque slice's depth planes, each through three corners at its depth, after
 *  \`tileColumn\`. The near plane's normal points away from the eye: the front plane faces
 *  along it, the back plane against it — an orientation no thin or slanted slice can flip. */
fn tileSlab(){
 let away=column[4].xyz;
 let f0=corners[FRONT_ROW*4u];let f1=corners[FRONT_ROW*4u+1u];let f2=corners[FRONT_ROW*4u+2u];
 let b0=corners[BACK_ROW*4u];let b1=corners[BACK_ROW*4u+1u];let b2=corners[BACK_ROW*4u+2u];
 slab[0]=inwardPlane(cross(f1-f0,f2-f0),f0,f0+away);
 slab[1]=inwardPlane(cross(b1-b0,b2-b0),b0,b0-away);
}
fn sphereTouchesBox(box:Box,centre:vec3f,radius:f32)->bool{
 let outside=max(box.lo-centre,centre-box.hi);
 let clamped=max(outside,vec3f(0.0));
 return dot(clamped,clamped)<=radius*radius;
}
/** A sphere is out of the column only if it lies wholly behind one of its planes. */
fn sphereTouchesColumn(centre:vec3f,radius:f32)->bool{
 for(var i=0u;i<5u;i++){
  if(dot(column[i].xyz,centre)+column[i].w< -radius){return false;}
 }
 return true;
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
}
`;
