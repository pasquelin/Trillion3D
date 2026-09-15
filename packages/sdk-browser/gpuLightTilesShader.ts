import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';

const WORDS = Math.ceil(LIGHT_SETTINGS.maxLights / 32);

/**
 * Listes de lampes par tuile d'écran de 16 × 16 pixels. Un groupe de travail par tuile : les 256
 * fils réduisent la profondeur minimale et maximale de la tuile, le fil zéro en déduit les boîtes
 * englobantes monde de la tuile, chaque fil teste une lampe, puis chaque fil retenu écrit son rang à
 * la place que le compte de bits avant lui désigne — l'ordre reste croissant et déterminé, donc
 * l'image l'est aussi. Aucune boucle non bornée : chaque liste s'arrête à `maxLightsPerTile`, et le
 * nombre demandé est écrit à côté du nombre retenu.
 *
 * **Deux listes par tuile, deux tranches de profondeur.** La liste des opaques couvre la tranche
 * entre les deux profondeurs de la tuile, la plus serrée qui soit : c'est celle d'avant ce lot, au
 * bit près, et la résolution différée n'y perd ni une lampe ni une milliseconde. La liste du mélange
 * couvre la tranche du plan proche au fond opaque, et le tronc entier là où nul opaque ne couvre la
 * tuile : une surface de mélange est dessinée **devant** l'opaque de son pixel, et une boîte qui
 * commence à sa profondeur lui retirerait des lampes déclarées — un feuillage devant le ciel n'en
 * garderait aucune. Une seule passe, une seule réduction de profondeur, deux compactions.
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
/** Un seul masque, deux tranches : les ${WORDS} premiers mots sont ceux de la liste opaque, les
 *  suivants ceux de la liste du mélange. Une seule fonction de rang sait les lire, indexée par le
 *  début de sa tranche — aucun pointeur vers la mémoire de groupe, que tous les appareils ne
 *  prennent pas en paramètre. */
const OPAQUE_MASK:u32=0u;
const BLEND_MASK:u32=${WORDS}u;
var<workgroup> hits:array<atomic<u32>,${2 * WORDS}u>;
var<workgroup> opaqueBox:Box;
var<workgroup> blendBox:Box;
fn unproject(ndc:vec3f)->vec3f{
 let point=view.inverseViewProjection*vec4f(ndc,1.0);
 return point.xyz/point.w;
}
/** Boîte monde de la tuile entre deux profondeurs : huit coins, jamais un rayon. */
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
/** Le rang d'une lampe retenue : le nombre de bits retenus avant elle dans la même tranche. */
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
  atomicStore(&nearest,0xffffffffu);
  atomicStore(&farthest,0u);
  atomicStore(&covered,0u);
  for(var word=0u;word<${2 * WORDS}u;word++){atomicStore(&hits[word],0u);}
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
  opaqueBox=tileBox(tile.xy,front,back);
  blendBox=tileBox(tile.xy,0.0,back);
 }
 workgroupBarrier();
 let count=min(lights.count,MAX_LIGHTS);
 if(lane<count){
  let light=lights.items[lane];
  // Une lampe directionnelle porte partout : aucune boîte de tuile ne peut la rejeter. Les autres
  // ne sont retenues que si leur sphère de portée touche la boîte monde de la tranche.
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
 // Compaction en parallele : chaque fil ecrit sa lampe a son rang, donc chaque liste porte les
 // memes rangs de lampe dans le meme ordre croissant que la boucle d'un seul fil qu'elle remplace.
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
