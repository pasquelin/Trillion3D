import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';

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
 * The opaque slice's two depth planes and the slice tests, beside the tile's column (`./shader.ts`):
 * thread zero builds them, every thread reads them. A light is kept in a slice only if its range
 * sphere meets both the slice's box and its planes: the planes are the tile's own frustum, much
 * tighter than a box once the tile is seen from above or at a slant. Everything is in the pass's
 * eye frame (`tileViewInverse`), so a plane's terms are the size of the view, and a sphere is out
 * only when wholly behind a plane, with no margin, as the sky column always was.
 * `oracles/browser/gpuLightTileColumnOracle.ts` ports it line by line.
 */
export const TILE_BOUNDS_WGSL = `/** The opaque slice's front and back depth planes, facing each other: with the column's four
 *  sides, the six planes of the tile's frustum between its two depths. */
var<workgroup> slab:array<vec4f,2>;
/** The tile's four corners at depth z, in \`tileCorner\`'s order. */
fn tileCorners(tile:vec2u,z:f32)->array<vec3f,4>{
 return array<vec3f,4>(tileCorner(tile,0u,z),tileCorner(tile,1u,z),tileCorner(tile,2u,z),tileCorner(tile,3u,z));
}
/** Box of four corners at one depth and four at another: eight corners, never a radius. */
fn boxOf(a:array<vec3f,4>,b:array<vec3f,4>)->Box{
 let lo=min(min(min(a[0],a[1]),min(a[2],a[3])),min(min(b[0],b[1]),min(b[2],b[3])));
 let hi=max(max(max(a[0],a[1]),max(a[2],a[3])),max(max(b[0],b[1]),max(b[2],b[3])));
 return Box(lo,hi);
}
/** The opaque slice's box and depth planes, after \`tileColumn\`. A plane of one depth is parallel
 *  to the near plane — one depth is one distance along the view axis —, so both take its normal,
 *  \`away\` from the eye, through a corner at their depth. */
fn tileSlab(front:array<vec3f,4>,back:array<vec3f,4>){
 opaqueBox=boxOf(front,back);
 let away=column[4].xyz;
 slab[0]=vec4f(away,-dot(away,front[0]));
 slab[1]=vec4f(-away,dot(away,back[0]));
}
/** A sphere wholly behind a plane: out of every slice the plane bounds. */
fn sphereBehind(plane:vec4f,centre:vec3f,radius:f32)->bool{
 return dot(plane.xyz,centre)+plane.w< -radius;
}
fn sphereInSides(centre:vec3f,radius:f32)->bool{
 for(var i=0u;i<4u;i++){if(sphereBehind(column[i],centre,radius)){return false;}}
 return true;
}
/** The lists that keep a light other than the sun: \`x\` the opaque one, \`y\` the blend one. A tile
 *  that sees the sky blends over its whole column. Otherwise both slices lie within the column's
 *  sides and in front of the opaque slice's back plane, tested once: the opaque one behind its
 *  front plane, the blend one behind the near plane. */
fn sliceHits(centre:vec3f,radius:f32,hasOpaque:bool,seesSky:bool)->vec2<bool>{
 var hit=vec2<bool>(false,seesSky&&sphereTouchesColumn(centre,radius));
 if(hasOpaque&&sphereInSides(centre,radius)&&!sphereBehind(slab[1],centre,radius)){
  hit.x=sphereTouchesBox(opaqueBox,centre,radius)&&!sphereBehind(slab[0],centre,radius);
  if(!seesSky){hit.y=sphereTouchesBox(blendBox,centre,radius)&&!sphereBehind(column[4],centre,radius);}
 }
 return hit;
}`;
