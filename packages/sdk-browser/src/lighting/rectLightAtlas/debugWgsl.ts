import { IN_RECT, ON_BORDER } from '../overlayWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

/**
 * THE ATLAS'S DEBUG VIEW, in WGSL (`rectLightAtlasDebug`): the atlas drawn small at the top left of the image at the chosen mip level, every
 * slot in use with a green border, the horizon lines of the packing with a red border and the free rectangles dimmed with a yellow one
 * (`DEBUG_WGSL`, a compute pass writing a texture of the picture's size, laid over the image by `../overlayBlit.ts`). The figures are written as text by the debug lines (`debug.ts`).
 */

/** The left and the top of the atlas's picture, in display pixels, and the share of the display's width it takes. */
const DEBUG_ATLAS_OFFSET = [50, 250] as const
const DEBUG_ATLAS_SCALE = 0.25

/** The pixels of the display the atlas's picture takes (`atlas` its size in texels): the pass dispatches over them alone. */
export const debugAtlasRect = (displayWidth: number, atlas: { x: number; y: number }) => {
  const width = Math.max(1, Math.floor(displayWidth * DEBUG_ATLAS_SCALE))
  return {
    x: DEBUG_ATLAS_OFFSET[0],
    y: DEBUG_ATLAS_OFFSET[1],
    width,
    height: Math.max(1, Math.floor((width * atlas.y) / atlas.x)),
  }
}

export const DEBUG_WGSL = wgslProgram(
  `
struct DebugFigures{atlas:vec2u,shown:vec2u,slotCount:u32,horizonCount:u32,freeCount:u32,mip:u32,}
@group(0) @binding(0) var<uniform> figures:DebugFigures;
@group(0) @binding(1) var atlasTexture:texture_2d<f32>;
@group(0) @binding(2) var atlasSampler:sampler;
@group(0) @binding(3) var<storage,read> slotRects:array<vec4u>;
@group(0) @binding(4) var<storage,read> horizonRects:array<vec4u>;
@group(0) @binding(5) var<storage,read> freeRects:array<vec4u>;
@group(0) @binding(6) var result:texture_storage_2d<rgba8unorm,write>;
@compute @workgroup_size(8,8,1) fn mainCs(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=figures.shown)){return;}
 let atlas=vec2f(figures.atlas);
 let shown=figures.shown;
 var out=vec4f(0.0);
 if(all(id.xy>vec2u(0u))){
  let uv=vec2f(id.xy)/vec2f(shown);
  let at=uv*atlas;
  let colour=textureSampleLevel(atlasTexture,atlasSampler,uv,f32(figures.mip));
  let width=atlas.x/f32(shown.x)*2.0;
  var picture=vec4f(0.0);
  for(var i=0u;i<figures.slotCount;i++){
   let r=vec4f(slotRects[i]);
   if(inRect(at,r.xy,r.xy+r.zw)){
    picture=colour;
    if(onBorder(at,r.xy,r.xy+r.zw,width)){picture=vec4f(0.0,1.0,0.0,1.0);break;}
   }
  }
  for(var i=0u;i<figures.horizonCount;i++){
   let r=vec4f(horizonRects[i]);
   if(inRect(at,r.xy,r.xy+r.zw)&&onBorder(at,r.xy,r.xy+r.zw,width)){picture=vec4f(1.0,0.0,0.0,1.0);break;}
  }
  for(var i=0u;i<figures.freeCount;i++){
   let r=vec4f(freeRects[i]);
   if(inRect(at,r.xy,r.xy+r.zw)){
    picture=colour*0.25;
    if(onBorder(at,r.xy,r.xy+r.zw,width)){picture=vec4f(1.0,1.0,0.0,1.0);break;}
   }
  }
  out=vec4f(picture.xyz,1.0);
 }
 textureStore(result,id.xy,out);
}`,
  [IN_RECT, ON_BORDER],
)
