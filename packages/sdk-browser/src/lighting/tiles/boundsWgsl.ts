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
 * The opaque slice's two depth planes and the slice tests, beside the tile's boxes and column
 * (`./shader.ts`): thread zero builds them, every thread reads them. A light is kept in a slice
 * only if its range sphere meets both the slice's box and its planes: the planes are the tile's
 * own frustum, much tighter than a box once the tile is seen from above or at a slant.
 * `oracles/browser/gpuLightTileColumnOracle.ts` ports it line by line.
 */
export const TILE_BOUNDS_WGSL = `/** The opaque slice's front and back depth planes, facing each other: with the column's four
 *  sides, the six planes of the tile's frustum between its two depths. */
var<workgroup> slab:array<vec4f,2>;
/** The opaque slice's depth planes, each through three corners at its depth, after
 *  \`tileColumn\`. The near plane's normal points away from the eye: the front plane faces
 *  along it, the back plane against it — an orientation no thin or slanted slice can flip. */
fn tileSlab(tile:vec2u,front:f32,back:f32){
 let away=column[4].xyz;
 let f0=tileCorner(tile,0u,front);let f1=tileCorner(tile,1u,front);let f2=tileCorner(tile,2u,front);
 let b0=tileCorner(tile,0u,back);let b1=tileCorner(tile,1u,back);let b2=tileCorner(tile,2u,back);
 slab[0]=inwardPlane(cross(f1-f0,f2-f0),f0,f0+away);
 slab[1]=inwardPlane(cross(b1-b0,b2-b0),b0,b0-away);
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
