import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { sinFromCosUnclamped } from '../../../../../math/src/wgsl/geometry.ts'
import { AIR_TINT_WGSL } from '../../atmosphere/airTintWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { lightChannelsOf } from '../../direct/lightReachWgsl.ts'
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../../direct/lampSeenWgsl.ts'
import { CONE_SPHERE_WGSL } from '../../direct/lightDrawWgsl.ts'
import { CM_PER_M_WGSL, VIEW_EXPOSURE } from './commonWgsl.ts'
import { CULLED_LIGHT_TILE_WGSL } from './lightTilesWgsl.ts'

/**
 * WHAT THE PROGRAMS THAT PICK THE LIGHTS OF A TILE SHARE (`cullWgsl.ts`, `stochasticWgsl.ts`): which lights reach a tile (`tileLightReached`) and the weight of each
 * (`tileLightWeight`), and the appending of the picks to the list of light tiles (`tileLightAppendWgsl`).
 *
 * A light is a candidate where it shares a lighting channel with the card's object (`ScCard.channels`, the light's `lightChannelsOf`; tested first, a sun's too) and
 * its factor on the indirect lighting is above 0, and its influence sphere reaches the tile's box — its range about its position, a spot's the sphere that bounds its
 * cone (`influenceSphere`) —, and a spot's cone (`sphereIntersectCone`, between its tip and its range) or a rectangle's front half space holds the box's bounding sphere;
 * a sun always. A light's weight is the luminance of its colour as the cards take it (`lightBrightness`) times how much of it reaches the tile's centre
 * (`tileLightReach`: a lamp's falloff, its range window and a spot's fade; a rectangle's range window times its integral with no normal, `rectTileForm`, none behind
 * its face). The program binds the lights as `directLights`, beside the cards' tables (`lightingCommonWgsl`).
 */

/** The floor under which a rectangle's edge cosine plus one is not taken, so that an edge a half turn about the point does not
 *  blow its weight up. */
const RECT_LIGHT_SAFE_THRESHOLD = 1e-4

/** The tile's box and the lights that reach it, and their weights. */
export const TILE_LIGHT_REACH_WGSL = wgslBlock(
  'TILE_LIGHT_REACH_WGSL',
  [
    sinFromCosUnclamped,
    DIRECT_LIGHT_WGSL,
    lightStrengthWgsl(VIEW_EXPOSURE),
    VOLUME_LAMP_WGSL,
    AIR_TINT_WGSL,
    CM_PER_M_WGSL,
    lightChannelsOf,
    CONE_SPHERE_WGSL,
    luminance,
  ],
  `const RECT_LIGHT_SAFE_THRESHOLD:f32=${wgslF32(RECT_LIGHT_SAFE_THRESHOLD)};
/** The sphere that bounds the light's influence, its centre and radius in centimetres: its range about its position, a spot's
 *  the sphere that holds its cone (\`coneSphere\`, its range along its outer cone). */
fn influenceSphere(light:DirectLight)->vec4f{
 let position=light.positionRange.xyz*CM_PER_M;
 let range=light.positionRange.w*CM_PER_M;
 if(!isSpot(light)){return vec4f(position,range);}
 return coneSphere(position,light.directionCone.xyz,range,light.directionCone.w);
}
/** Whether a sphere of \`radius\` about \`centre\` meets the cone of tip \`tip\` along \`axis\`, whose cosine and sine are given. */
fn sphereIntersectCone(centre:vec3f,radius:f32,tip:vec3f,axis:vec3f,cosCone:f32,sinCone:f32)->bool{
 let apex=tip-(radius/sinCone)*axis;
 var d=centre-apex;
 var lengthSquared=dot(d,d);
 var e=dot(axis,d);
 if(e>0.0&&e*e>=lengthSquared*cosCone*cosCone){
  d=centre-tip;
  lengthSquared=dot(d,d);
  e=-dot(axis,d);
  if(e>0.0&&e*e>=lengthSquared*sinCone*sinCone){return lengthSquared<=radius*radius;}
  return true;
 }
 return false;
}
/** A tile's box in its card's space and in the world, in centimetres: its centre and half sides, and its card. */
struct TileBox{card:ScCard,centre:vec3f,reach:vec3f}
fn tileBox(page:u32,tile:vec2u,depths:vec2f)->TileBox{
 var b:TileBox;
 b.card=scCard(scPageW(page,0u));
 let tiles=vec2f(pageSize(page)/vec2u(LG_TILE));
 let uv0=vec2f(scPageF(page,4u),scPageF(page,5u));
 let span=vec2f(scPageF(page,6u),scPageF(page,7u))-uv0;
 let low=uv0+span*vec2f(tile)/tiles;
 let high=uv0+span*(vec2f(tile)+vec2f(1.0))/tiles;
 let lowest=scCardLocal(b.card.extent,vec2f(low.x,high.y),depths.y);
 let highest=scCardLocal(b.card.extent,vec2f(high.x,low.y),depths.x);
 b.centre=0.5*(highest+lowest);
 b.reach=0.5*(highest-lowest);
 return b;
}
/** The tile's centre in the world, in centimetres. */
fn tileWorldCentre(b:TileBox)->vec3f{return b.card.origin+b.card.axisX*b.centre.x+b.card.axisY*b.centre.y+b.card.axisZ*b.centre.z;}
/** The luminance of light \`rank\`'s colour as the cards take it: its colour times its strength (\`lightStrength\`), times the factor on its indirect
 *  lighting (\`contactGi.w\`) and the air's tint toward it at the ground (\`airGroundTintOf\`, one for any light but a sun that asks
 *  for its transmittance per point). */
fn lightBrightness(rank:u32,light:DirectLight)->f32{
 return luminance(light.colorIntensity.rgb*lightStrength(light)*light.contactGi.w*airGroundTintOf(rank));
}
/** The integral of a rectangle with no normal, of its view \`r\` from the point, as the reference's cheap form factor takes it: the unit
 *  directions to its corners, each edge weighed by the angle it subtends, \`(1.5708 - 0.175 c) / sqrt(c + 1)\` for the cosine \`c\` of
 *  the edge's two directions (the angle's polynomial over its sine), their vector sum's length half; nothing for a rectangle
 *  with no width or no height. */
fn rectTileForm(light:DirectLight,r:RectView)->f32{
 if(!any(light.shape.xyz!=vec3f(0.0))||light.shape.w==0.0){return 0.0;}
 let L0=normalize(r.a);let L1=normalize(r.b);let L2=normalize(r.c);let L3=normalize(r.d);
 let c01=dot(L0,L1);let c12=dot(L1,L2);let c23=dot(L2,L3);let c30=dot(L3,L0);
 let w01=(1.5708-0.175*c01)*inverseSqrt(max(c01+1.0,RECT_LIGHT_SAFE_THRESHOLD));
 let w12=(1.5708-0.175*c12)*inverseSqrt(max(c12+1.0,RECT_LIGHT_SAFE_THRESHOLD));
 let w23=(1.5708-0.175*c23)*inverseSqrt(max(c23+1.0,RECT_LIGHT_SAFE_THRESHOLD));
 let w30=(1.5708-0.175*c30)*inverseSqrt(max(c30+1.0,RECT_LIGHT_SAFE_THRESHOLD));
 let L=cross(L1,-w01*L0+w12*L2)+cross(L3,w30*L0-w23*L2);
 return 0.5*length(L);
}
/** What of a local light reaches the point \`P\` (metres) before its colour: the lamp's falloff times its mask (\`volumeLamp\`, no
 *  bias), a rectangle's range window times its integral (\`rectTileForm\`), nothing behind its face. */
fn tileLightReach(light:DirectLight,P:vec3f)->f32{
 if(!isRect(light)){return volumeLamp(light,P,0.0).w;}
 if(dot(light.directionCone.xyz,P-light.positionRange.xyz)<0.0){return 0.0;}
 let r=rectView(light,P);
 return r.window*rectTileForm(light,r);
}
/** Whether light \`rank\` reaches the tile: not where it shares no lighting channel with the card's object, nor where its factor on the indirect
 *  lighting (\`contactGi.w\`) is not above 0, the cards gather none of it, nor where its range, cone or face leaves the box; a sun always, past those. */
fn tileLightReached(light:DirectLight,b:TileBox)->bool {
 if((b.card.channels&lightChannelsOf(light))==0u){return false;}
 if(light.contactGi.w<=0.0){return false;}
 if(isSun(light)){return true;}
 let position=light.positionRange.xyz*CM_PER_M;
 let range=light.positionRange.w*CM_PER_M;
 let worldCentre=tileWorldCentre(b);
 let influence=influenceSphere(light);
 let toInfluence=influence.xyz-b.card.origin;
 let local=vec3f(dot(toInfluence,b.card.axisX),dot(toInfluence,b.card.axisY),dot(toInfluence,b.card.axisZ));
 let outside=max(abs(local-b.centre)-b.reach,vec3f(0.0));
 if(dot(outside,outside)>=influence.w*influence.w){return false;}
 let radius=length(b.reach);
 let direction=light.directionCone.xyz;
 if(isSpot(light)){
  let cosCone=light.directionCone.w;
  let along=dot(worldCentre-position,direction);
  return sphereIntersectCone(worldCentre,radius,position,direction,cosCone,sinFromCosUnclamped(cosCone))&&along+radius>0.0&&along-radius<range;
 }
 if(isRect(light)){
  let spread=abs(b.card.axisX)*b.reach.x+abs(b.card.axisY)*b.reach.y+abs(b.card.axisZ)*b.reach.z;
  return dot(direction,worldCentre-position)+dot(spread,abs(direction))>0.0;
 }
 return true;
}
/** The weight of light \`rank\` for the tile, -1 where it does not reach it (\`tileLightReached\`); the key's weight is its brightness times what reaches the centre. */
fn tileLightWeight(rank:u32,light:DirectLight,b:TileBox)->f32 {
 if(!tileLightReached(light,b)){return -1.0;}
 if(isSun(light)){return lightBrightness(rank,light);}
 return lightBrightness(rank,light)*tileLightReach(light,tileWorldCentre(b)/CM_PER_M);
}
`,
)

/** The bindings of the program that appends a tile's lights to the list of light tiles (`tileLightAppendWgsl`): the light tiles written, the offsets and counts of the tiles' lights written, and the bits of the lights whose light function the atlas holds no slot of, read. */
export interface TileLightAppendBindings {
  readonly culled: number
  readonly cardTileOffsets: number
  readonly standalone: number
}

/**
 * What the program that picks a tile's lights ends with, whichever picks them (the cull, or the stochastic light's generation):
 * the picks of the workgroup (`tilePicks`, a light's rank in the low `TILE_LIGHT_RANK_BITS` bits and its kind from bit 14, the key's own layout) and `appendTileLights`, which
 * the thread that leads calls to give the tile a light tile for each: the counters of the light tiles given out and of the entries in the tiles' lists give the
 * places of its own, it appends its light tiles to the list of them — the tile, the light's word, its place among the tile's and its kind — counts each in its
 * slot's counter, and records where its lights begin in the tiles' lists and how many it keeps, nothing where it keeps none. `maxLights` is the most picks a tile
 * makes (`MAX_LIGHTS`, the size of `tilePicks`); the list of light tiles may hold fewer than the picks of all the tiles, and a tile then keeps those that fit.
 */
export const tileLightAppendWgsl = (b: TileLightAppendBindings, maxLights: number) =>
  wgslBlock(
    `TILE_LIGHT_APPEND_WGSL(${b.culled},${b.cardTileOffsets},${b.standalone},${maxLights})`,
    [CULLED_LIGHT_TILE_WGSL, DIRECT_LIGHT_WGSL],
    `${wgslConsts({ MAX_LIGHTS: maxLights })}
@group(0) @binding(${b.culled}) var<storage,read_write> culledTiles:array<u32>;
@group(0) @binding(${b.cardTileOffsets}) var<storage,read_write> cardTileOffsets:array<u32>;
@group(0) @binding(${b.standalone}) var<storage,read> standaloneLights:array<u32>;
var<workgroup> tilePicks:array<u32,MAX_LIGHTS>;
/** Whether light \`rank\` wears a light function the atlas holds no slot of. */
fn standaloneLight(rank:u32)->bool{return ((standaloneLights[rank/32u]>>(rank%32u))&1u)!=0u;}
/** The light's type in its key: 0 for a sun, 1 a point light, 2 a spot, 3 a rectangle; 0 for a light apart from the atlas, whatever its kind. */
fn lightKind(light:DirectLight,standalone:bool)->u32{
 if(standalone||isSun(light)){return 0u;}
 if(isSpot(light)){return 2u;}
 return select(1u,3u,isRect(light));
}
/** The \`wanted\` first of \`tilePicks\` appended as the light tiles of the tile \`tile\` of the direct list, and how many were: all of them, but for the ones the list of light tiles
 *  has no room for (the room the buffer holds); the tile's lists take as many as the list. */
fn appendTileLights(tile:u32,wanted:u32)->u32{
 var kept=0u;
 var lightsAt=0u;
 var tilesAt=0u;
 if(wanted>0u){
  let room=arrayLength(&culledTiles)/LIGHT_TILE_WORDS;
  lightsAt=atomicAdd(&lightTileCounts[LT_ALLOCATOR],wanted);
  kept=select(0u,min(wanted,room-lightsAt),lightsAt<room);
  if(kept<wanted){atomicSub(&lightTileCounts[LT_ALLOCATOR],wanted-kept);}
  if(kept>0u){tilesAt=atomicAdd(&lightTileCounts[LT_CARD_TILE_ALLOCATOR],kept);}
 }
 for(var k=0u;k<kept;k++){
  let rank=tilePicks[k]&0x3fffu;
  let kind=(tilePicks[k]>>14u)&3u;
  let at=(lightsAt+k)*LIGHT_TILE_WORDS;
  culledTiles[at]=tile;
  culledTiles[at+1u]=culledTileWord(rank|select(0u,TILE_LIGHT_STANDALONE,standaloneLight(rank)),k,kind);
  atomicAdd(&lightTileCounts[givenAt(lightTileSlot(kind,rank))],1u);
 }
 cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS]=tilesAt;
 cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS+1u]=kept;
 return kept;
}`,
  )
