/**
 * THE COST OF SAMPLING EACH PIXEL (`complexityCostMain`) and the heat map that shows it (`heatmapFs`), for the light complexity view of the surfaces and of the nearest translucent layer.
 * The cost is, per pixel, the sum over the lights its cell holds (the local lights that are drawn, the suns where they join the sampling) of what weighing that light for that pixel costs: one,
 * plus 0.25 for a surface of another shading model and 0.5 for one with a lobe of its own, plus 0.25 for a rectangle light, 0.5 more for one with a picture, 0.25 for a light with a source
 * of size, 0.5 for one with a light function and 0.5 for one with a profile; a light that shares no lighting channel with the pixel costs 0.1. The heat map paints each pixel with the cost, in a
 * hue from blue (low) to red (`sampledLightsVisualizeLightComplexityMaxCost` or more) times the grey of the image, white where no light is weighed.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { SURFACE_WORDS } from '../../../../materials/surface/surfaceOutputs.ts'
import { channelsOfFlags } from '../../../../materials/surface/surfaceChannels.ts'
import { SCREEN_PASS_VERTEX } from '../../../../diagnostic/screenPass.ts'
import { hasLightFunctionWgsl } from '../../../lightFunction/readWgsl.ts'
import { LIGHT_PROFILE_LANE_WGSL } from '../../../lightProfile/lightProfileWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../../../deferred/lightPassWgsl.ts'
import { PIXEL_CLASS, PIXEL_TILE_CLASS_WGSL } from '../../../deferred/tileClass.ts'
import {
  DEPTH_BINDING_WGSL,
  VIEW_BINDING_WGSL,
  WORDS_BINDING_WGSL,
} from '../../../deferred/litSurfaceWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../../direct/lightWgsl.ts'
import { lightChannelsOf, lightTraits } from '../../../direct/lightReachWgsl.ts'
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../../../direct/lightingWgsl.ts'
import { SAMPLED_BINDINGS } from '../../bindings.ts'
import { SAMPLED_PARAMS_WGSL } from '../../paramsWgsl.ts'
import { SUN_RANKS_BINDING_WGSL, TILES_BINDING_WGSL, TOWARD_WGSL } from '../../samplingWgsl.ts'
import { SAMPLED_GROUP } from '../../layout.ts'

const B = SAMPLED_BINDINGS
export const COST_ENTRY = 'complexityCostMain'
export const HEATMAP_ENTRY = 'heatmapFs'
/** The words of the heat map's block: the cost texture's size over the display's, and the cost painted red. */
export const HEATMAP_BLOCK_WORDS = 4

/** The cost of weighing one light for a pixel. */
const COST_COSTS = {
  channelMiss: 0.1,
  base: 1,
  single: 0.25,
  complex: 0.5,
  rect: 0.25,
  texturedRect: 0.5,
  area: 0.25,
  lightFunction: 0.5,
  profile: 0.5,
} as const
const C = COST_COSTS

/** The kernel that writes the cost of every pixel of the view into the `r32float` texture at `complexityCost`. */
export const costWgsl = () =>
  wgslProgram(
    `@group(0) @binding(${B.complexityCost}) var cost:texture_storage_2d<r32float,write>;
/** The cost of weighing light 'light' for a pixel of the lighting channels 'channels' whose surface adds 'add'. */
fn lightCost(add:f32,channels:u32,light:DirectLight)->f32{
 if((channels&lightChannelsOf(light))==0u){return ${C.channelMiss};}
 var total=${C.base}+add;
 if(isRect(light)){total+=${C.rect}+select(0.0,${C.texturedRect},rectSlotOf(light).z>0.0);}
 if(isAreaLight(light)){total+=${C.area};}
 if(hasLightFunction(light)){total+=${C.lightFunction};}
 if(lightProfileLane(light)!=0u){total+=${C.profile};}
 return total;
}
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${COST_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(view.viewport.xy))){return;}
 let coord=vec2i(id.xy);
 let flag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;
 let found=pixelTileClass(flag);
 var total=0.0;
 if(found!=${PIXEL_CLASS.none}u){
  let add=select(select(0.0,${C.single},found==${PIXEL_CLASS.single}u),${C.complex},found==${PIXEL_CLASS.complex}u);
  let channels=channelsOfFlags(flag);
  let cell=cellSlice(pixelCell(vec2f(id.xy)+vec2f(0.5),textureLoad(depth,coord,0)));
  for(var index=0u;index<cell.y;index++){
   let rank=listedLight(cell,index);
   if(!listedDrawn(cell,rank)||!sampledTakes(rank)||isSun(directLights.items[rank])){continue;}
   total+=lightCost(add,channels,directLights.items[rank]);
  }
  if(params.directional!=0u){
   for(var index=1u;index<=sunRanks[0];index++){total+=lightCost(add,channels,directLights.items[sunRanks[index]]);}
  }
 }
 textureStore(cost,coord,vec4f(total,0.0,0.0,0.0));
}`,
    [
      DIRECT_LIGHT_WGSL,
      TILE_SLICE_WGSL,
      pixelCellWgsl(),
      VIEW_BINDING_WGSL,
      WORDS_BINDING_WGSL,
      DEPTH_BINDING_WGSL,
      PIXEL_TILE_CLASS_WGSL,
      LIGHTS_BINDING_WGSL,
      TILES_BINDING_WGSL,
      SUN_RANKS_BINDING_WGSL,
      SAMPLED_PARAMS_WGSL,
      lightChannelsOf,
      channelsOfFlags,
      hasLightFunctionWgsl,
      LIGHT_PROFILE_LANE_WGSL,
      lightTraits,
      TOWARD_WGSL,
    ],
  )

/** The screen pass that paints the heat map over a copy of the image (`scene`) from the cost texture: the grey of the image times the cost's colour, written in place of the image. */
export const HEATMAP_WGSL = wgslBlock(
  'COMPLEXITY_HEATMAP_WGSL',
  [],
  `struct Heatmap{scale:vec2f,maxCost:f32,pad:f32}
@group(0) @binding(0) var<uniform> heat:Heatmap;
@group(0) @binding(1) var scene:texture_2d<f32>;
@group(0) @binding(2) var costs:texture_2d<f32>;
${SCREEN_PASS_VERTEX}
/** The colour of 'x' from 0 (blue) to 1 (red) round the hue wheel; nothing below 0. */
fn hsvDebugColor(x:f32)->vec3f{
 let hue=(1.0-saturate(x))*0.6;
 return saturate(vec3f(abs(hue*6.0-3.0)-1.0,2.0-abs(hue*6.0-2.0),2.0-abs(hue*6.0-4.0)));
}
@fragment fn ${HEATMAP_ENTRY}(@builtin(position) pos:vec4f)->@location(0) vec4f{
 let colour=textureLoad(scene,vec2i(pos.xy),0).rgb;
 let grey=(colour.x+colour.y+colour.z)/3.0;
 let cost=textureLoad(costs,vec2i(min(pos.xy*heat.scale,vec2f(textureDimensions(costs))-vec2f(1.0))),0).x;
 let tint=select(vec3f(1.0),hsvDebugColor(cost/heat.maxCost),cost>0.0);
 return vec4f(vec3f(grey)*tint,1.0);
}`,
)
