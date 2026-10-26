import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../../direct/lampSeenWgsl.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from './commonWgsl.ts'

/**
 * THE LIGHTS OF EACH TILE: a workgroup a tile of the direct update's list, a thread a texel of it for the tile's depth
 * range — the least and the greatest depth of the texels that hold a surface, 0 to 1 where none does —, which bounds the
 * tile's box in its card's space; the threads then walk the scene's lights between them, each its share, and keep the
 * `maxLights` of the most weight (`cullLights`, `lightSampleKey`): a light's weight is its luminance times how much of
 * it reaches the tile's centre (`volumeLamp`: its falloff, and a rectangle's form factor, its range window and a spot's
 * fade). A light is a candidate where its range's sphere reaches the tile's box, and a spot's cone (`sphereIntersectCone`,
 * between its tip and its range) or a rectangle's front half space holds the box's bounding sphere; a sun always. Each
 * thread keeps its own best lights, ordered by key, and the workgroup takes the greatest of their heads `maxLights` times
 * (`groupMax`): the list of a tile is its count and its lights' ranks, the heaviest first, at `(maxLights + 1)` words
 * a tile of the list's buffer.
 *
 * The tile list and the pages' records are the update context's (`contextWgsl.ts`); bindings: 0 the parameters, 1 the tables,
 * 2 the context, 3 and 4 the depth and normal layers, 5 the lights of the tiles written, 6 the light buffer.
 */

export const CULL_ENTRY = 'cullLights'

/** The cull program's bindings and the helpers of the workgroup's reduction and of a light's key and cone. */
const cullHelpersWgsl = (maxLights: number) => `${wgslConsts({ MAX_LIGHTS: maxLights })}
@group(0) @binding(5) var<storage,read_write> tileLights:array<u32>;
@group(0) @binding(6) var<storage,read> directLights:DirectLights;
var<workgroup> reduction:array<u32,${WORKGROUP_THREADS}>;
var<workgroup> depthRange:array<atomic<u32>,2>;
/** The greatest of \`value\` over the workgroup. */
fn groupMax(lane:u32,value:u32)->u32{
 reduction[lane]=value;
 workgroupBarrier();
 for(var stride=${WORKGROUP_THREADS / 2}u;stride>=1u;stride/=2u){
  if(lane<stride){reduction[lane]=max(reduction[lane],reduction[lane+stride]);}
  workgroupBarrier();
 }
 let greatest=reduction[0];
 workgroupBarrier();
 return greatest;
}
/** The light's key (\`lightSampleKey\`): the weight's top bits over the light's rank. */
fn lightKey(weight:f32,rank:u32)->u32{return ((bitcast<u32>(weight)<<1u)&0xfffe0000u)|(rank&0x3fffu);}
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
/** The weight of light \`rank\` for the tile, 0 where it does not reach it: the key's weight is its luminance times what reaches the centre. */
fn tileLightWeight(light:DirectLight,b:TileBox)->f32 {
 let worldCentre=b.card.origin+b.card.axisX*b.centre.x+b.card.axisY*b.centre.y+b.card.axisZ*b.centre.z;
 let brightness=luminance(light.colorIntensity.rgb*light.colorIntensity.w);
 if(isSun(light)){return brightness;}
 let position=light.positionRange.xyz*100.0;
 let range=light.positionRange.w*100.0;
 let toLight=position-b.card.origin;
 let local=vec3f(dot(toLight,b.card.axisX),dot(toLight,b.card.axisY),dot(toLight,b.card.axisZ));
 let outside=max(abs(local-b.centre)-b.reach,vec3f(0.0));
 if(dot(outside,outside)>=range*range){return -1.0;}
 let radius=length(b.reach);
 let direction=light.directionCone.xyz;
 if(isSpot(light)){
  let cosCone=light.directionCone.w;
  let along=dot(worldCentre-position,direction);
  let inside=sphereIntersectCone(worldCentre,radius,position,direction,cosCone,sqrt(1.0-cosCone*cosCone))&&along+radius>0.0&&along-radius<range;
  if(!inside){return -1.0;}
 }else if(isRect(light)){
  let spread=abs(b.card.axisX)*b.reach.x+abs(b.card.axisY)*b.reach.y+abs(b.card.axisZ)*b.reach.z;
  if(!(dot(direction,worldCentre-position)+dot(spread,abs(direction))>0.0)){return -1.0;}
 }
 return brightness*volumeLamp(light,worldCentre*0.01,0.0).w;
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
fn ${CULL_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 if(lane==0u){atomicStore(&depthRange[0],0x7f800000u);atomicStore(&depthRange[1],0u);}
 workgroupBarrier();
 let texel=surfaceTexel(page,coord*LG_TILE+at.xy);
 if(texel.valid){
  let depth=f32(texDepth(texel.atlas)&0xffffu)/65535.0;
  atomicMin(&depthRange[0],bitcast<u32>(depth));
  atomicMax(&depthRange[1],bitcast<u32>(depth));
 }
 workgroupBarrier();
 let lowest=atomicLoad(&depthRange[0]);
 let highest=atomicLoad(&depthRange[1]);
 let depths=select(vec2f(bitcast<f32>(lowest),bitcast<f32>(highest)),vec2f(0.0,1.0),lowest==0x7f800000u);
 let box=tileBox(page,coord,depths);
 var best:array<u32,MAX_LIGHTS>;
 for(var i=0u;i<MAX_LIGHTS;i++){best[i]=0u;}
 for(var rank=lane;rank<directLights.count;rank+=${WORKGROUP_THREADS}u){
  let weight=tileLightWeight(directLights.items[rank],box);
  if(weight>=0.0){keepKey(&best,lightKey(weight,rank));}
 }
 var kept=0u;var cursor=0u;
 let at0=tile*(MAX_LIGHTS+1u);
 for(var k=0u;k<MAX_LIGHTS;k++){
  var mine=0u;
  if(cursor<MAX_LIGHTS){mine=best[cursor];}
  let picked=groupMax(lane,mine);
  if(picked!=0u){
   if(picked==mine){cursor++;}
   if(lane==0u){tileLights[at0+1u+kept]=picked&0x3fffu;}
   kept++;
  }
 }
 if(lane==0u){tileLights[at0]=kept;}
}`

/** The cull program for tiles that keep `maxLights` lights. */
export const cullWgsl = (maxLights: number) =>
  wgslProgram(cullHelpersWgsl(maxLights) + CULL_TILE_TEXT + cullKernelWgsl(), [
    lightingCommonWgsl({ tables: 1, context: { binding: 2, access: 'read' } }),
    surfaceTexelWgsl(lightingLayersWgsl(3, 4)),
    DIRECT_LIGHT_WGSL,
    VOLUME_LAMP_WGSL,
    luminance,
  ])
