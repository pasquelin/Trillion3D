import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { sinFromCosUnclamped } from '../../../../../math/src/wgsl/geometry.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { AIR_TINT_WGSL } from '../../atmosphere/airTintWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { lightChannelsOf } from '../../direct/lightReachWgsl.ts'
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../../direct/lampSeenWgsl.ts'
import { hasLightFunctionWgsl } from '../../lightFunction/readWgsl.ts'
import { CM_PER_M_WGSL, lightingCommonWgsl, VIEW_EXPOSURE } from './commonWgsl.ts'
import { LIGHT_CENTRE_FACING_WGSL } from './shadowMaskWgsl.ts'
import { CULLED_LIGHT_TILE_WGSL, lightTileCountsWgsl } from './lightTilesWgsl.ts'
import { CONE_SPHERE_WGSL } from '../../direct/lightDrawWgsl.ts'

/**
 * THE LIGHTS OF EACH TILE: a workgroup a tile of the direct update's list. The tile's depth range — the least and the
 * greatest depth of the texels that hold a surface, kept as the two half floats of a word, which the pass before writes
 * (`tileDepthRangeWgsl.ts`) — bounds the tile's box in its card's space (the card's whole depth, 0 to 1, where
 * `surfaceCacheDirectLightingCullToTileDepthRange` is off); the threads walk the scene's lights between them, each its share, and keep the
 * `maxLights` of the most weight (`cullLights`, `lightSampleKey`): a light's weight is the luminance of its colour as the
 * cards take it (`lightBrightness`) times how much of it reaches the tile's centre (`tileLightReach`: a lamp's falloff, its range
 * window and a spot's fade; a rectangle's range window times its integral with no normal, `rectTileForm`, none behind its face). A light is a candidate where it shares a lighting channel with the card's object (`ScCard.channels`, the light's `lightChannelsOf`; tested first, a sun's too) and its factor on the indirect lighting is above 0, and its influence sphere reaches the tile's box — its range about its position, a spot's
 * the sphere that bounds its cone (`influenceSphere`) —, and a spot's cone (`sphereIntersectCone`, between its tip and its
 * range) or a rectangle's front half space holds the box's bounding sphere; a sun always. Each
 * thread keeps its own best lights, ordered by key (the weight over the light's type and whether it needs a shadow mask), and the workgroup takes the greatest of their heads `maxLights` times
 * (`groupMax`): the lights a tile keeps are its heaviest first. The thread of the workgroup that leads gives the tile a light
 * tile for each (`lightTilesWgsl.ts`): the counters of the light tiles given out and of the entries in the tiles' lists give the
 * places of its own, it appends its light tiles to the list of them — the tile, the light's word, its place among the tile's
 * and its kind — counts each in its slot's counter, and records where its lights begin in the tiles' lists and how many it keeps
 * (`cardTileOffsets`), nothing where it keeps none.
 *
 * A light that wears a light function the atlas holds no slot of (`standalone`, a bit a light) needs a shadow mask like one that
 * casts a shadow, and is marked as such in the word that names it (`TILE_LIGHT_STANDALONE`), so that the
 * passes after read its function from the scratch (`lightFunctionPassWgsl.ts`).
 *
 * The tile list and the pages' records are the update context's (`contextWgsl.ts`); bindings: 0 the parameters, 1 the tables,
 * 2 the context, 3 the counters, 4 the offsets and counts of the tiles' lights, 5 the light tiles, 6 the light buffer, 7 the
 * depth ranges of the tiles, 8 the bits of the lights that hold no slot of the light functions' atlas.
 */

export const CULL_ENTRY = 'cullLights'

/** The bindings of the cull beside the tables (1) and the context (2): the counters, the offsets and counts of the tiles' lights and
 *  the light tiles written, the light buffer, the depth ranges of the tiles (`tileDepthRangeWgsl.ts`) and the bits of the lights whose
 *  light function the atlas holds no slot of, read. */
export const CULL_BINDINGS = {
  tables: 1,
  context: 2,
  counts: 3,
  cardTileOffsets: 4,
  culled: 5,
  lights: 6,
  depthRanges: 7,
  standalone: 8,
} as const

const B = CULL_BINDINGS

/** The floor under which a rectangle's edge cosine plus one is not taken, so that an edge a half turn about the point does not
 *  blow its weight up. */
const RECT_LIGHT_SAFE_THRESHOLD = 1e-4

/** The cull program's bindings and the helpers of the workgroup's reduction and of a light's key and cone. */
const cullHelpersWgsl = (maxLights: number) => `${wgslConsts({ MAX_LIGHTS: maxLights })}
const RECT_LIGHT_SAFE_THRESHOLD:f32=${wgslF32(RECT_LIGHT_SAFE_THRESHOLD)};
@group(0) @binding(${B.culled}) var<storage,read_write> culledTiles:array<u32>;
@group(0) @binding(${B.cardTileOffsets}) var<storage,read_write> cardTileOffsets:array<u32>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.depthRanges}) var<storage,read> depthRanges:array<u32>;
@group(0) @binding(${B.standalone}) var<storage,read> standaloneLights:array<u32>;
/** Whether light \`rank\` wears a light function the atlas holds no slot of. */
fn standaloneLight(rank:u32)->bool{return ((standaloneLights[rank/32u]>>(rank%32u))&1u)!=0u;}
var<workgroup> reduction:array<u32,${WORKGROUP_THREADS}>;
/** The greatest of \`value\` over the workgroup. */
fn groupMax(lane:u32,value:u32)->u32{
 reduction[lane]=value;
 ${workgroupSumLoop(WORKGROUP_THREADS, 'reduction[lane]=max(reduction[lane],reduction[lane+stride]);')}
 let greatest=reduction[0];
 workgroupBarrier();
 return greatest;
}
/** The light's type in its key: 0 for a sun, 1 a point light, 2 a spot, 3 a rectangle. */
fn lightType(light:DirectLight)->u32{
 if(isSun(light)){return 0u;}
 if(isSpot(light)){return 2u;}
 return select(1u,3u,isRect(light));
}
/** The light's key (\`lightSampleKey\`): its rank in bits 0 to 13, its type in bits 14 and 15 (0 for a standalone light, whatever its kind), whether it needs a shadow mask
 *  (\`needsShadowMask\`) in bit 16, the weight's top bits over them. */
fn lightKey(weight:f32,rank:u32,light:DirectLight,standalone:bool)->u32{
 return ((bitcast<u32>(weight)<<1u)&0xfffe0000u)|(select(0u,0x10000u,needsShadowMask(rank,light,standalone)))|((select(lightType(light),0u,standalone)<<14u)&0xc000u)|(rank&0x3fffu);
}
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
`

/** A tile's box, the weight of a light for it, and the keeping of the best keys. */
const CULL_TILE_TEXT = `/** A tile's box in its card's space and in the world, in centimetres: its centre and half sides, and its card. */
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
/** The weight of light \`rank\` for the tile, -1 where it does not reach it: first where it shares no lighting channel with the
 *  card's object, then where its factor on the indirect lighting (\`contactGi.w\`) is not above 0, the cards gather none of it, then where its
 *  range, cone or face leaves the box; the key's weight is its brightness times what reaches the centre. */
fn tileLightWeight(rank:u32,light:DirectLight,b:TileBox)->f32 {
 if((b.card.channels&lightChannelsOf(light))==0u){return -1.0;}
 if(light.contactGi.w<=0.0){return -1.0;}
 let worldCentre=b.card.origin+b.card.axisX*b.centre.x+b.card.axisY*b.centre.y+b.card.axisZ*b.centre.z;
 if(isSun(light)){return lightBrightness(rank,light);}
 let position=light.positionRange.xyz*CM_PER_M;
 let range=light.positionRange.w*CM_PER_M;
 let influence=influenceSphere(light);
 let toInfluence=influence.xyz-b.card.origin;
 let local=vec3f(dot(toInfluence,b.card.axisX),dot(toInfluence,b.card.axisY),dot(toInfluence,b.card.axisZ));
 let outside=max(abs(local-b.centre)-b.reach,vec3f(0.0));
 if(dot(outside,outside)>=influence.w*influence.w){return -1.0;}
 let radius=length(b.reach);
 let direction=light.directionCone.xyz;
 if(isSpot(light)){
  let cosCone=light.directionCone.w;
  let along=dot(worldCentre-position,direction);
  let inside=sphereIntersectCone(worldCentre,radius,position,direction,cosCone,sinFromCosUnclamped(cosCone))&&along+radius>0.0&&along-radius<range;
  if(!inside){return -1.0;}
 }else if(isRect(light)){
  let spread=abs(b.card.axisX)*b.reach.x+abs(b.card.axisY)*b.reach.y+abs(b.card.axisZ)*b.reach.z;
  if(!(dot(direction,worldCentre-position)+dot(spread,abs(direction))>0.0)){return -1.0;}
 }
 return lightBrightness(rank,light)*tileLightReach(light,worldCentre/CM_PER_M);
}
/** Keeps \`key\` among the keys of \`best\`, in descending order, the least dropped. */
fn keepKey(best:ptr<function,array<u32,MAX_LIGHTS>>,keyIn:u32){
 var key=keyIn;
 for(var i=0u;i<MAX_LIGHTS;i++){
  let held=(*best)[i];
  if(key>held){(*best)[i]=key;key=held;}
 }
}
`

/** The kernel: a workgroup a tile of the direct update's list. */
const cullKernelWgsl = () => `@compute @workgroup_size(8,8,1)
fn ${CULL_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 var depths=vec2f(0.0,1.0);
 if(lgFlag(FLAG_CULL_TO_TILE_DEPTH_RANGE)){depths=unpack2x16float(depthRanges[tile]);}
 let box=tileBox(page,coord,depths);
 var best:array<u32,MAX_LIGHTS>;
 for(var i=0u;i<MAX_LIGHTS;i++){best[i]=0u;}
 for(var rank=lane;rank<directLights.count;rank+=${WORKGROUP_THREADS}u){
  let weight=tileLightWeight(rank,directLights.items[rank],box);
  if(weight>=0.0){keepKey(&best,lightKey(weight,rank,directLights.items[rank],standaloneLight(rank)));}
 }
 var kept=0u;var cursor=0u;
 var picks:array<u32,MAX_LIGHTS>;
 for(var k=0u;k<MAX_LIGHTS;k++){
  var mine=0u;
  if(cursor<MAX_LIGHTS){mine=best[cursor];}
  let picked=groupMax(lane,mine);
  if(picked!=0u){
   if(picked==mine){cursor++;}
   picks[kept]=picked;
   kept++;
  }
 }
 if(lane==0u){
  var lightsAt=0u;
  var tilesAt=0u;
  if(kept>0u){
   lightsAt=atomicAdd(&lightTileCounts[LT_ALLOCATOR],kept);
   tilesAt=atomicAdd(&lightTileCounts[LT_CARD_TILE_ALLOCATOR],kept);
  }
  for(var k=0u;k<kept;k++){
   let rank=picks[k]&0x3fffu;
   let kind=(picks[k]>>14u)&3u;
   let at=(lightsAt+k)*LIGHT_TILE_WORDS;
   culledTiles[at]=tile;
   culledTiles[at+1u]=culledTileWord(rank|select(0u,TILE_LIGHT_STANDALONE,standaloneLight(rank)),k,kind);
   atomicAdd(&lightTileCounts[givenAt(lightTileSlot(kind,rank))],1u);
  }
  cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS]=tilesAt;
  cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS+1u]=kept;
 }
}`

/** The cull program for tiles that keep `maxLights` lights. */
export const cullWgsl = (maxLights: number) =>
  wgslProgram(cullHelpersWgsl(maxLights) + CULL_TILE_TEXT + cullKernelWgsl(), [
    sinFromCosUnclamped,
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    lightTileCountsWgsl(B.counts, 'atomic'),
    CULLED_LIGHT_TILE_WGSL,
    DIRECT_LIGHT_WGSL,
    lightStrengthWgsl(VIEW_EXPOSURE),
    VOLUME_LAMP_WGSL,
    LIGHT_CENTRE_FACING_WGSL,
    AIR_TINT_WGSL,
    CM_PER_M_WGSL,
    hasLightFunctionWgsl,
    lightChannelsOf,
    CONE_SPHERE_WGSL,
    luminance,
  ])
