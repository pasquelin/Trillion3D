/**
 * THE VIRTUAL SHADOW MAP VIEWS' PROJECTION (`visualizePass.ts`): the two kernels that draw, for each pixel, what its lights' last rays read, in the colour the chosen view gives it. They are the
 * suns' and the local lights' projection (`projectionWgsl.ts`) run again with a trace that keeps the page its last ray read (`vsmSeen`, `../trace/traceRayWgsl.ts`), and write a colour
 * where the projection writes a share: the suns' kernel writes the sum of the suns, the local lights' kernel reads it and adds the local lights', in the order of the lights. A light
 * the view chooses (`shadowVisualizeLight`) is drawn alone and in full colour; else every light adds a quarter of its colour to the pixel's. The views of the pages read the page's
 * state in the pool's page record (`vsmPoolPageInfo`).
 *
 * The state words of a page are ours for the reference's: a layer to draw again is a page mark (`VSM_PAGE_DYNAMIC_STALE`, `VSM_PAGE_STATIC_STALE`), a page kept by force
 * `VSM_META_FORCE_CACHED`, a layer written this image (cleared or drawn) `VSM_META_DYNAMIC_DRAWN` / `VSM_META_STATIC_DRAWN`, and a layer the casters invalidated
 * `VSM_META_DYNAMIC_STALE` / `VSM_META_STATIC_STALE`.
 */
import { VIRTUAL_SHADOW_MAP_VIEWS } from '../../../../../../sdk-core/src/runtime/diagnostics.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../../math/src/wgsl/number.ts'
import { greenToRedTurbo } from '../../../../../../math/src/wgsl/turbo.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../../../math/src/wgsl/constants.ts'
import { SUBGROUP_ALL_WGSL } from '../../../../gpu/core/subgroups.ts'
import { VIEW_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../../direct/lightWgsl.ts'
import { pixelCellWgsl } from '../../../direct/lightingWgsl.ts'
import { SHADOW_SLICE_WGSL } from '../../../direct/shadowSlice.ts'
import { VSM_CONSTANTS_WGSL, VSM_PROJECTION_GROUP_SIZE, VSM_UNIT_PER_CM } from '../constants.ts'
import { VSM_PAGE_ADDRESS_WGSL } from '../pageTableWgsl.ts'
import { vsmGrayscale, vsmIntToColor, vsmVirtualPageColor } from '../debug/pageColorWgsl.ts'
import { VSM_TRACE_RESULT_WGSL } from '../trace/traceCommonWgsl.ts'
import { VSM_TRACE_KINDS_LOCAL, VSM_TRACE_KINDS_SUN } from '../trace/traceWgsl.ts'
import type { VsmBindingSpec } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import {
  LOCALS_LANE_LIGHT,
  LOCALS_LIST_DECL,
  localsBoundText,
  VSM_PROJECTION_PIXEL_OF_WGSL,
} from './projectionEntryWgsl.ts'
import { VSM_LIGHT_GRID_WGSL } from './lightGridWgsl.ts'
import {
  VSM_PROJECTION_OPAQUE_WGSL,
  VSM_PROJECTION_PIXEL_WGSL,
  vsmProjectionVoteWgsl,
} from './projectionPixelWgsl.ts'
import { VSM_PROJECTION_SUBSURFACE_WGSL, vsmProjectionRegionWgsl } from './projectionRegionWgsl.ts'
import {
  BINDINGS_WGSL,
  PROJECTION_VIEW,
  STRANDS_TILE_SLICE_WGSL,
  VSM_PROJECTION_BINDING,
  projectionCommon,
  traceDeps,
} from './projectionWgsl.ts'

/** The tables the views read: the projection's but the counters, with the pool's page records. */
export const VSM_VISUALIZE_VSM_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'projectionData', binding: 2 },
  { resource: 'pagePool', binding: 4 },
  { resource: 'poolPageInfo', binding: 6 },
]

/** The words of the views' uniform (`VSM_PROJECTION_BINDING.visualize`): the mode id (`VIRTUAL_SHADOW_MAP_VIEWS`), the record of the one light shown (−1, every light), whether the cached-page view shows the kept pages only. */
export const VSM_VISUALIZE_PARAM_WORDS = 4

/** The WGSL constant of a view's mode id. */
export const modeConstant = (view: string) =>
  `VSM_VIEW_${view.replace('virtual-shadow-map-', '').toUpperCase().replaceAll('-', '_')}`

/** The mode ids as WGSL constants, named after the views. */
const MODE_CONSTANTS = Object.entries(VIRTUAL_SHADOW_MAP_VIEWS)
  .map(([view, id]) => `const ${modeConstant(view)}:u32=${id}u;`)
  .join('\n')

/**
 * The colour a light adds at a pixel, `vsmVisualizeOutput`: from the light's record `k`, its trace's result `r` (the share, the rays traced, the distance to the occluder) and the page its
 * last ray read (`vsmSeen`), the pixel's colour `accumulator` so far. A pixel the light does not shade, or a light the view does not choose, leaves it as it is.
 */
export const VSM_VISUALIZE_OUTPUT_WGSL = wgslBlock(
  'VSM_VISUALIZE_OUTPUT_WGSL',
  [
    VSM_CONSTANTS_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_TRACE_RESULT_WGSL,
    NO_INDEX,
    vsmIntToColor,
    vsmVirtualPageColor,
    vsmGrayscale,
  ],
  `
struct VsmVizParams{mode:u32,light:i32,cachedOnly:u32,spare:u32,}
@group(1) @binding(${VSM_PROJECTION_BINDING.visualize}) var<uniform> vsmViz:VsmVizParams;
${MODE_CONSTANTS}
fn vsmVisualizeOutput(k:u32,r:VsmTraceResult,accumulator:vec4f,directional:bool)->vec4f{
 let one=vsmViz.light>=0;
 if(one&&u32(vsmViz.light)!=k){return accumulator;}
 if(r.rayCount==0u){return accumulator;}
 let seen=vsmSeen;
 let haveSeen=seen.map!=NO_INDEX;
 let level=select(0u,seen.mip,haveSeen);
 let pageColor=vsmVirtualPageColor(select(vec2u(0xffffffffu),seen.virtualTexel,haveSeen));
 let poolPage=seen.poolTexel>>vec2u(VSM_LOG2_PAGE);
 let validPage=haveSeen&&poolPage.x<=vsm.poolRowMask&&vsmPoolIndexOf(poolPage)<vsm.poolPages;
 var pageFlags=0u;
 if(validPage){pageFlags=vsmPoolPageInfo[vsmPoolIndexOf(poolPage)].flags;}
 let shadow=vec3f(r.shadowFactor);
 var output=vec4f(1.0,0.0,1.0,0.0);
 if(vsmViz.mode==VSM_VIEW_SHADOW_FACTOR){
  output=mix(vec4f(0.0,0.0,0.5,1.0),vec4f(1.0,1.0,0.0,1.0),r.shadowFactor);
  if(!one){
   output=accumulator+output*0.25;
   // A bit of blue keeps the contrast in the shadowed areas; the alpha stays one, as the other views' (the sum of the lights' would pass it).
   output.b=min(output.b,0.12);
   output.a=1.0;
  }
 }else if(vsmViz.mode==VSM_VIEW_CLIPMAP_OR_MIP){
  output=vec4f(0.8*vsmIntToColor(level)+0.2*shadow,1.0);
  if(!one){output=accumulator+output*0.25;output.a=1.0;}
 }else if(vsmViz.mode==VSM_VIEW_VIRTUAL_PAGE&&validPage){
  output=vec4f(0.4*pageColor+0.4*vsmIntToColor(level)+0.2*shadow,1.0);
  if(!one){output=accumulator+output*0.25;output.a=1.0;}
 }else if(vsmViz.mode==VSM_VIEW_RAY_COUNT){
  let rayMost=select(vsmView.traceRays.y,vsmView.traceRays.x,directional);
  output=vec4f(accumulator.xy+vec2f(f32(r.rayCount),f32(rayMost)),0.0,1.0);
 }else if(vsmViz.mode==VSM_VIEW_CACHED_PAGE&&validPage){
  let redrawDynamic=(pageFlags&VSM_PAGE_DYNAMIC_STALE)!=0u;
  let redrawStatic=(pageFlags&VSM_PAGE_STATIC_STALE)!=0u;
  let keptByForce=(pageFlags&VSM_META_FORCE_CACHED)!=0u;
  let cachedOnly=vsmViz.cachedOnly!=0u;
  let cacheAlpha=select(0.25,0.9,one);
  var pageAlpha=0.0;
  var cacheColor=vec4f(0.0);
  // Red: both layers to draw again; blue: the dynamic layer alone.
  if(redrawDynamic){
   if(!cachedOnly){cacheColor=select(vec4f(0.0,0.0,1.0,cacheAlpha),vec4f(1.0,0.0,0.0,cacheAlpha),redrawStatic);}
  }else if(keptByForce){
   if(!cachedOnly){cacheColor=vec4f(0.75,1.0,0.0,cacheAlpha);}
  }else if(one||cachedOnly){
   cacheColor=vec4f(0.0,1.0,0.0,cacheAlpha);
   pageAlpha=0.1;
  }
  if(cacheColor.a>0.0){
   let rgb=cacheColor.a*cacheColor.rgb+pageAlpha*pageColor+0.1*shadow;
   output=vec4f(rgb+accumulator.rgb,0.9);
  }else{
   output=vec4f(0.0);
  }
 }else if(vsmViz.mode==VSM_VIEW_DIRTY_PAGE){
  var color=pageColor*0.4;
  var dirtyColor=color;
  if(!one){color=vec3f(vsmGrayscale(color));}
  if(validPage){
   if((pageFlags&VSM_META_STATIC_DRAWN)!=0u){dirtyColor.x=1.0;}
   if((pageFlags&VSM_META_DYNAMIC_DRAWN)!=0u){dirtyColor.y=1.0;}
   color=mix(color,dirtyColor,0.8);
  }
  output=vec4f(color,1.0);
  if(!one){output=accumulator+output*0.25;output.a=1.0;}
 }else if(vsmViz.mode==VSM_VIEW_GPU_INVALIDATED_PAGE){
  var cacheColor=vec3f(0.0);
  if(validPage){
   if((pageFlags&VSM_META_STATIC_STALE)!=0u){cacheColor.x=1.0;}
   if((pageFlags&VSM_META_DYNAMIC_STALE)!=0u){cacheColor.y=1.0;}
  }
  if(one){
   output=vec4f(0.55*cacheColor+0.25*pageColor+0.2*shadow,1.0);
  }else{
   output=vec4f(0.55*cacheColor+0.25*vsmGrayscale(pageColor)+0.2*shadow,1.0);
   output=accumulator+output*0.25;
   output.a=1.0;
  }
 }else if(vsmViz.mode==VSM_VIEW_MERGED_PAGE){
  let merged=(pageFlags&VSM_META_STATIC_DRAWN)!=0u;
  if(one){
   output=vec4f(0.55*select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),merged)+0.25*pageColor+0.2*shadow,1.0);
  }else{
   output=vec4f(0.55*select(vec3f(0.0),vec3f(1.0,0.0,0.0),merged)+0.25*vsmGrayscale(pageColor)+0.2*shadow,1.0);
   output=accumulator+output*0.25;
   output.a=1.0;
  }
 }else if(vsmViz.mode==VSM_VIEW_GENERAL_DEBUG){
  // The distance to the occluder, 2000 centimetres to white.
  output=vec4f(vec3f(r.occluderDistance/${wgslF32(2000 * VSM_UNIT_PER_CM)}),1.0);
  if(!one){output=accumulator+output*0.25;output.a=1.0;}
 }
 if(output.a>0.0){return output;}
 return accumulator;
}
`,
)

/** The colour of a pixel of the ray count view in the post pass: the rays traced over the most (`sums`: x the rays traced, y the most), from green to red, brighter with the number of lights. */
export const VSM_VISUALIZE_RAY_COLOR_WGSL = wgslBlock(
  'VSM_VISUALIZE_RAY_COLOR_WGSL',
  [greenToRedTurbo],
  `
fn vsmRayCountColor(sums:vec2f,one:bool)->vec3f{
 let intensity=select(smoothstep(0.0,64.0,sums.y)+0.5,1.0,one);
 return greenToRedTurbo(intensity*sums.x/max(sums.y,1.0));
}
`,
)

const GROUP_SIZE = `@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})`

/** The suns' kernel of the views: the sum of the suns' colours at each pixel of the rect. */
const SUNS_ENTRY = /* wgsl */ `
${GROUP_SIZE}
fn vsmVisualizeSuns(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 let receiver=vsmReceiverOf(pixel,pixel.info.valid);
 var colour=vec4f(0.0);
 for(var k=0u;k<vsmView.sunCount;k++){
  let inLight=vsmLightParticipates(k,pixel.info,pixel.shifted);
  vsmSeen.map=NO_INDEX;
  let r=vsmSubsurfaceShadow(vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight),pixel.info);
  colour=vsmVisualizeOutput(k,r,colour,true);
 }
 if(pixel.inRect){textureStore(vsmVizOut,pixel.pos,colour);}
}
`

/** The local lights' kernel of the views: the suns' sum (`vsmVizIn`) and the colours of the lights of the pixel's cell, in the order of the one-pass projection. */
const localsEntry = (subgroups: boolean) => /* wgsl */ `
${LOCALS_LIST_DECL}
${GROUP_SIZE}
fn vsmVisualizeLocals(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 var colour=vec4f(0.0);
 if(pixel.inRect){colour=textureLoad(vsmVizIn,pixel.pos,0);}
 var list=vec2u(0u);
 if(pixel.info.valid){
  list=vsmShadowedList(pixelCell(vec2f(pixel.pos)-vec2f(vsmView.projectionRect.xy)+0.5,pixel.deviceZ));
 }
${localsBoundText(subgroups)}
 if(bound==0u){
  if(pixel.inRect){textureStore(vsmVizOut,pixel.pos,colour);}
  return;
 }
 let receiver=vsmReceiverOf(pixel,pixel.info.valid);
 for(var lane=0u;lane<bound;lane++){
${LOCALS_LANE_LIGHT}
  vsmSeen.map=NO_INDEX;
  let r=vsmSubsurfaceShadow(vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight),pixel.info);
  if(listed){colour=vsmVisualizeOutput(k,r,colour,false);}
 }
 if(pixel.inRect){textureStore(vsmVizOut,pixel.pos,colour);}
}
`

/** The views' colour target, written by both kernels. */
const OUTPUT_BINDING = `@group(1) @binding(${VSM_PROJECTION_BINDING.visualizeOut}) var vsmVizOut:texture_storage_2d<rgba16float,write>;`

/** The suns' kernel of the views for the pool `layout`, over the opaque surfaces: `vsmVisualizeSuns` writes the sum of the suns' colours. The halves of a group vote as the projection's do (`subgroups`). */
export function vsmVisualizeSunsWgsl(layout: VsmLayout, subgroups = false) {
  return wgslProgram(
    [
      PROJECTION_VIEW,
      BINDINGS_WGSL,
      OUTPUT_BINDING,
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      VSM_PROJECTION_OPAQUE_WGSL,
      vsmProjectionRegionWgsl('gbuffer'),
      VSM_PROJECTION_SUBSURFACE_WGSL,
      SUNS_ENTRY,
    ].join('\n'),
    [
      ...projectionCommon(layout, VSM_PROJECTION_PIXEL_OF_WGSL, VSM_VISUALIZE_VSM_SPECS),
      ...traceDeps(layout, VSM_TRACE_KINDS_SUN, 'gbuffer', true, VSM_VISUALIZE_VSM_SPECS),
      VSM_VISUALIZE_OUTPUT_WGSL,
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
    ],
  )
}

/**
 * The local lights' kernel of the views for the pool `layout`: `vsmVisualizeLocals` adds the colours of the lights of each pixel's cell to the suns'. The cell is read in the shadowed
 * lights' grid, as the strands' projection reads it: the eight storage buffers of a stage hold the tables, the lights and that grid alone.
 */
export function vsmVisualizeLocalsWgsl(layout: VsmLayout, subgroups = false) {
  return wgslProgram(
    [
      PROJECTION_VIEW,
      BINDINGS_WGSL,
      OUTPUT_BINDING,
      `@group(1) @binding(${VSM_PROJECTION_BINDING.visualizeIn}) var vsmVizIn:texture_2d<f32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.deferredView}) var<uniform> view:View;
@group(1) @binding(${VSM_PROJECTION_BINDING.directLights}) var<storage,read> directLights:DirectLights;
@group(1) @binding(${VSM_PROJECTION_BINDING.lightGrid}) var<storage,read> vsmLightGrid:array<u32>;`,
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      VSM_PROJECTION_OPAQUE_WGSL,
      vsmProjectionRegionWgsl('gbuffer'),
      VSM_PROJECTION_SUBSURFACE_WGSL,
      localsEntry(subgroups),
    ].join('\n'),
    [
      ...projectionCommon(layout, VSM_PROJECTION_PIXEL_OF_WGSL, VSM_VISUALIZE_VSM_SPECS),
      ...traceDeps(layout, VSM_TRACE_KINDS_LOCAL, 'gbuffer', true, VSM_VISUALIZE_VSM_SPECS),
      VSM_VISUALIZE_OUTPUT_WGSL,
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
      VIEW_WGSL,
      DIRECT_LIGHT_WGSL,
      STRANDS_TILE_SLICE_WGSL,
      pixelCellWgsl(),
      SHADOW_SLICE_WGSL,
      VSM_LIGHT_GRID_WGSL,
    ],
  )
}
