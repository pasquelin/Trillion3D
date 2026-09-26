import { DEPTH_NEAR } from '../../camera/depthConvention.ts';

/**
 * The world bounds of a screen tile the light-list pass tests each light against
 * (`./shader.ts`): the box between two depths, from its eight corners, and the column from the near
 * plane to infinity a tile that sees the sky gives its blend list. They read the pass's `view`
 * and write its workgroup `column`.
 */
export const TILE_BOUNDS_WGSL = `
/** Depth the column's planes are read at: any depth short of the background gives the same
 *  planes; a deep one spreads the corners apart, so the planes keep their precision far from
 *  the world origin. A numerical choice, independent of the scene. */
const COLUMN_DEPTH:f32=${DEPTH_NEAR / 1024};
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
/** World box of the tile between two depths: eight corners, never a radius. */
fn tileBox(tile:vec2u,front:f32,back:f32)->Box{
 var box:Box;
 box.lo=vec3f(1e30);
 box.hi=vec3f(-1e30);
 for(var corner=0u;corner<8u;corner++){
  let world=tileCorner(tile,corner&3u,select(front,back,(corner&4u)!=0u));
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
fn tileColumn(tile:vec2u){
 var order=array<u32,4>(0u,1u,3u,2u);
 var near:array<vec3f,4>;
 var deep:array<vec3f,4>;
 var inside=vec3f(0.0);
 for(var i=0u;i<4u;i++){
  near[i]=tileCorner(tile,order[i],${DEPTH_NEAR}.0);
  deep[i]=tileCorner(tile,order[i],COLUMN_DEPTH);
  inside+=deep[i]*0.25;
 }
 for(var i=0u;i<4u;i++){
  column[i]=inwardPlane(cross(deep[(i+1u)%4u]-deep[i],deep[i]-near[i]),near[i],inside);
 }
 column[4]=inwardPlane(cross(deep[1]-deep[0],deep[3]-deep[0]),near[0],inside);
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
`;
