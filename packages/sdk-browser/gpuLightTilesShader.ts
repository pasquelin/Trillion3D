import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';

const WORDS = Math.ceil(LIGHT_SETTINGS.maxLights / 32);

/**
 * Listes de lampes par tuile d'écran de 16 × 16 pixels. Un groupe de travail par tuile : les 256
 * fils réduisent la profondeur minimale et maximale de la tuile, le fil zéro en déduit la boîte
 * englobante monde de la tuile, chaque fil teste une lampe, puis le fil zéro écrit les rangs retenus
 * dans l'ordre croissant — l'ordre est déterminé, donc l'image l'est aussi. Aucune boucle non bornée :
 * la liste s'arrête à `maxLightsPerTile`, et le nombre demandé est écrit à côté du nombre retenu.
 */
export const LIGHT_TILES_SHADER = `
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,counts:vec4f,}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var<uniform> view:TileView;
@group(0) @binding(2) var<storage,read> lights:DirectLights;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
${DIRECT_LIGHT_WGSL}
var<workgroup> nearest:atomic<u32>;
var<workgroup> farthest:atomic<u32>;
var<workgroup> covered:atomic<u32>;
var<workgroup> hits:array<atomic<u32>,${WORDS}u>;
var<workgroup> boxMin:vec3f;
var<workgroup> boxMax:vec3f;
fn unproject(ndc:vec3f)->vec3f{
 let point=view.inverseViewProjection*vec4f(ndc,1.0);
 return point.xyz/point.w;
}
/** Boîte monde de la tuile entre ses deux profondeurs : huit coins, jamais un rayon. */
fn tileBox(tile:vec2u,front:f32,back:f32){
 let size=view.viewport.xy;
 let x0=f32(tile.x*TILE_SIZE)/size.x*2.0-1.0;
 let x1=min(f32((tile.x+1u)*TILE_SIZE)/size.x,1.0)*2.0-1.0;
 let y0=1.0-f32(tile.y*TILE_SIZE)/size.y*2.0;
 let y1=1.0-min(f32((tile.y+1u)*TILE_SIZE)/size.y,1.0)*2.0;
 var lo=vec3f(1e30);
 var hi=vec3f(-1e30);
 for(var corner=0u;corner<8u;corner++){
  let px=select(x0,x1,(corner&1u)!=0u);
  let py=select(y0,y1,(corner&2u)!=0u);
  let pz=select(front,back,(corner&4u)!=0u);
  let world=unproject(vec3f(px,py,pz));
  lo=min(lo,world);
  hi=max(hi,world);
 }
 boxMin=lo;
 boxMax=hi;
}
fn sphereTouchesBox(centre:vec3f,radius:f32)->bool{
 let outside=max(boxMin-centre,centre-boxMax);
 let clamped=max(outside,vec3f(0.0));
 return dot(clamped,clamped)<=radius*radius;
}
@compute @workgroup_size(${LIGHT_SETTINGS.tileSize},${LIGHT_SETTINGS.tileSize},1)
fn lightTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&nearest,0xffffffffu);
  atomicStore(&farthest,0u);
  atomicStore(&covered,0u);
  for(var word=0u;word<${WORDS}u;word++){atomicStore(&hits[word],0u);}
 }
 workgroupBarrier();
 let pixel=vec2u(tile.x*TILE_SIZE+lane%TILE_SIZE,tile.y*TILE_SIZE+lane/TILE_SIZE);
 if(pixel.x<u32(view.viewport.x)&&pixel.y<u32(view.viewport.y)){
  let z=textureLoad(depth,vec2i(pixel),0);
  if(z<1.0){
   atomicMin(&nearest,bitcast<u32>(z));
   atomicMax(&farthest,bitcast<u32>(z));
   atomicStore(&covered,1u);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  // Une tuile sans géométrie garderait des bornes non numériques : elle prend le tronc entier.
  let any=atomicLoad(&covered)==1u;
  let front=select(0.0,bitcast<f32>(atomicLoad(&nearest)),any);
  let back=select(1.0,bitcast<f32>(atomicLoad(&farthest)),any);
  tileBox(tile.xy,front,back);
 }
 workgroupBarrier();
 let count=min(lights.count,MAX_LIGHTS);
 if(lane<count&&atomicLoad(&covered)==1u){
  let light=lights.items[lane];
  // Une lampe directionnelle porte partout : aucune boîte de tuile ne peut la rejeter. Les autres
  // ne sont retenues que si leur sphère de portée touche la boîte monde de la tuile.
  let sun=isSun(light);
  if(sun||sphereTouchesBox(light.positionRange.xyz,light.positionRange.w)){
   atomicOr(&hits[lane/32u],1u<<(lane%32u));
  }
 }
 workgroupBarrier();
 if(lane==0u){
  let base=(tile.y*u32(view.viewport.z)+tile.x)*TILE_STRIDE;
  var kept=0u;
  var requested=0u;
  for(var index=0u;index<count;index++){
   if((atomicLoad(&hits[index/32u])&(1u<<(index%32u)))==0u){continue;}
   requested++;
   if(kept<MAX_TILE_LIGHTS){tiles[base+4u+kept]=index;kept++;}
  }
  tiles[base]=kept;
  tiles[base+1u]=requested;
 }
}`;
