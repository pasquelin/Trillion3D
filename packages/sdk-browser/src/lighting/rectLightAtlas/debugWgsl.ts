/**
 * THE ATLAS'S DEBUG VIEW, in WGSL (`rectLightAtlasDebug`): the atlas drawn small at the top left of the image at the chosen mip level, every
 * slot in use with a green border, the horizon lines of the packing with a red border and the free rectangles dimmed with a yellow one
 * (`DEBUG_WGSL`, a compute pass writing a texture of the display's size); and the pass that lays that texture over the image, blended as a
 * premultiplied colour (`BLIT_WGSL`). The figures are written as text by the debug lines (`debug.ts`).
 */

/** The left and the top of the atlas's picture, in display pixels, and the share of the display's width it takes. */
export const DEBUG_ATLAS_OFFSET = [50, 250] as const
export const DEBUG_ATLAS_SCALE = 0.25

export const DEBUG_WGSL = `
struct DebugFigures{atlas:vec2u,output:vec2u,slotCount:u32,horizonCount:u32,freeCount:u32,mip:u32,}
@group(0) @binding(0) var<uniform> figures:DebugFigures;
@group(0) @binding(1) var atlasTexture:texture_2d<f32>;
@group(0) @binding(2) var atlasSampler:sampler;
@group(0) @binding(3) var<storage,read> slotRects:array<vec4u>;
@group(0) @binding(4) var<storage,read> horizonRects:array<vec4u>;
@group(0) @binding(5) var<storage,read> freeRects:array<vec4u>;
@group(0) @binding(6) var result:texture_storage_2d<rgba8unorm,write>;
fn inRect(at:vec2f,low:vec2f,high:vec2f)->bool{return all(at>=low)&&all(at<=high);}
fn onBorder(at:vec2f,low:vec2f,high:vec2f,width:f32)->bool{
 return inRect(at,low,high)&&(any(at-low<=vec2f(width))||any(high-at<=vec2f(width)));
}
@compute @workgroup_size(8,8,1) fn mainCs(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=figures.output)){return;}
 let atlas=vec2f(figures.atlas);
 let shownWidth=u32(f32(figures.output.x)*${DEBUG_ATLAS_SCALE});
 let shown=vec2u(shownWidth,u32(f32(shownWidth)*atlas.y/atlas.x));
 let offset=vec2u(${DEBUG_ATLAS_OFFSET[0]}u,${DEBUG_ATLAS_OFFSET[1]}u);
 var out=vec4f(0.0);
 if(all(id.xy>offset)&&all(id.xy<offset+shown)){
  let uv=(vec2f(id.xy)-vec2f(offset))/vec2f(shown);
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
}`

/** The debug texture laid over the image, one texel to a pixel, its colour taken as premultiplied by its alpha. */
export const BLIT_WGSL = `
@group(0) @binding(0) var overlay:texture_2d<f32>;
@group(0) @binding(1) var overlaySampler:sampler;
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}
@fragment fn blit(@builtin(position) p:vec4f)->@location(0) vec4f{
 return textureSampleLevel(overlay,overlaySampler,p.xy/vec2f(textureDimensions(overlay)),0.0);
}`
