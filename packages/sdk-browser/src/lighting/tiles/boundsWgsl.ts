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
 let anyLit=near!=0u;let anySky=subgroupAny(inside&&!lit);
 if(subgroupElect()){
  if(anyLit){atomicMax(&nearest,near);atomicMin(&farthest,far);atomicStore(&covered,1u);}
  if(anySky){atomicStore(&skyward,1u);}
 }`;

/** The statements that fold a thread's depth `z` (`inside` the image) into the tile's bounds. */
export const tileDepthBoundsWgsl = (subgroups: boolean) =>
  subgroups ? SUBGROUP_DEPTH_BOUNDS : ATOMIC_DEPTH_BOUNDS;

/**
 * The tile's corner table, one corner per thread of the first sixteen, and the slice planes and
 * tests, beside the tile's column (`./shader.ts`): a light is kept only if its range sphere meets
 * the slice's box and the planes of the tile's frustum. In the pass's eye frame a plane's terms
 * are the size of the view: a sphere is out only when wholly behind one, no margin.
 * `oracles/browser/gpuLightTileColumnOracle.ts` ports it line by line.
 */
export const TILE_BOUNDS_WGSL = `/** The opaque slice's front and back depth planes, facing each other. */
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
/** Thread \`lane\` below 16 de-projects its corner, after the depth bounds: the corners of the
 *  rows are independent, so sixteen threads do at once what thread zero did one after the
 *  other, to the same bits. The row's depth is selected, never indexed: no private array. A
 *  tile no light reaches builds no bounds, so it de-projects nothing. */
fn tileCornerOfLane(tile:vec2u,lane:u32){
 if(lane<16u&&lightCount>0u){
  let row=lane/4u;
  let front=bitcast<f32>(atomicLoad(&nearest));
  let back=bitcast<f32>(atomicLoad(&farthest));
  let z=select(select(${DEPTH_NEAR}.0,COLUMN_DEPTH,row==DEEP_ROW),select(front,back,row==BACK_ROW),row>=FRONT_ROW);
  corners[lane]=tileCorner(tile,lane%4u,z);
 }
}
/** The \`i\`th corner of a row in turn around the tile — top left, top right, bottom right,
 *  bottom left —: the Gray code of \`i\`, so no private array of the order. */
fn columnCorner(row:u32,i:u32)->vec3f{
 return corners[row*4u+(i^(i>>1u))];
}
/** The opaque slice's depth planes, after \`tileColumn\`. A plane of one depth is parallel to
 *  the near plane — one depth is one distance along the view axis —, so both take its normal,
 *  \`away\` from the eye, through a corner at their depth. */
fn tileSlab(){
 let away=column[4].xyz;
 slab[0]=vec4f(away,-dot(away,corners[FRONT_ROW*4u]));
 slab[1]=vec4f(-away,dot(away,corners[BACK_ROW*4u]));
}
/** A sphere wholly behind a plane: out of every slice the plane bounds. */
fn sphereBehind(plane:vec4f,centre:vec3f,radius:f32)->bool{
 return dot(plane.xyz,centre)+plane.w< -radius;
}
fn sphereInSides(centre:vec3f,radius:f32)->bool{
 for(var i=0u;i<4u;i++){if(sphereBehind(column[i],centre,radius)){return false;}}
 return true;
}
/** Whether the opaque (\`x\`) and blend (\`y\`) lists keep a light other than the sun. Both slices
 *  lie within the column's sides, a sky tile's blend slice is the whole column, the others end at
 *  the opaque slice's back plane. */
fn sliceHits(centre:vec3f,radius:f32,hasOpaque:bool,seesSky:bool)->vec2<bool>{
 let sides=sphereInSides(centre,radius);
 var hit=vec2<bool>(false,seesSky&&sides&&!sphereBehind(column[4],centre,radius));
 if(hasOpaque&&sides&&!sphereBehind(slab[1],centre,radius)){
  hit.x=sphereTouchesBox(opaqueBox,centre,radius)&&!sphereBehind(slab[0],centre,radius);
  if(!seesSky){hit.y=sphereTouchesBox(blendBox,centre,radius)&&!sphereBehind(column[4],centre,radius);}
 }
 return hit;
}`;
