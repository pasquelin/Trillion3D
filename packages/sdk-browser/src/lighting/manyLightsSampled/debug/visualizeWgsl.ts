/**
 * THE DENOISER'S DEBUG VIEWS, one screen pass a view (`./visualize.ts`): over the display image, inside the view's tile, each pixel of a lit surface painted from what the temporal
 * and spatial filters left of it. The surface under it is shown as its shaded colours under a fixed light (the grey the spatial filter's debug output holds,
 * `../spatialDebugWgsl.ts`); the views then colour it:
 * - the shading confidence as grey; the frames accumulated, red where the history is invalid, yellow on the first frame, else grey over the longest history;
 * - the upsample mask, the surface dimmed and yellow where the pixel has no history; the demodulation factors, diffuse and specular, as the filters divide by them;
 * - the deviation of each light over its mean, as grey, red where a disocclusion boosts it, blue where the spatial filter runs, violet both;
 * - the history's own deviation over twice the threshold that makes it noisy, blue above it; the clamp of the history to the neighbourhood, from the surface to red, yellow when it is
 *   fully rejected.
 * The sky and what is no lit surface are left as the image shows them; in a tile of an overview, which hides the image, they are dark. The views of the shadow casters paint the
 * surface alone, as the software trace has no scene of its own to show.
 */
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SCREEN_PASS_VERTEX } from '../../../diagnostic/screenPass.ts'
import { VISUALIZE } from './modes.ts'
import { DEBUG_PIXEL_BLOCK, DEBUG_PIXEL_KIND } from '../spatialDebugWgsl.ts'

/** The words of the view's texel: the tile, the view's size with the longest history and the threshold of a noisy history, the view number and whether the image is hidden. */
export const VISUALIZE_BLOCK_WORDS = 12

export const VISUALIZE_ENTRY = 'visualizeFs'

const V = VISUALIZE

export const VISUALIZE_WGSL = wgslProgram(
  `struct Visualize{rect:vec4f,sizes:vec4f,mode:vec4u}
@group(0) @binding(0) var<uniform> vis:Visualize;
@group(0) @binding(1) var shadingConfidence:texture_2d<f32>;
@group(0) @binding(2) var filteredDiffuse:texture_2d<f32>;
@group(0) @binding(3) var filteredSpecular:texture_2d<f32>;
@group(0) @binding(4) var filteredFrames:texture_2d<u32>;
@group(0) @binding(5) var debugPixels:texture_2d<f32>;
${SCREEN_PASS_VERTEX}
@fragment fn ${VISUALIZE_ENTRY}(@builtin(position) pos:vec4f)->@location(0) vec4f{
 let local=pos.xy-vis.rect.xy;
 // A tile of an overview is a rounded rectangle; a view of the whole image is not clipped.
 if(vis.rect.x>0.0||vis.rect.y>0.0){
  let border=12.0;
  let outside=max(max(vec2f(border)-local,local-(vis.rect.zw-vec2f(border+1.0))),vec2f(0.0));
  if(length(outside)-border>=0.5){discard;}
 }
 let coord=vec2i(clamp(local/vis.rect.zw*vis.sizes.xy,vec2f(0.0),vis.sizes.xy-vec2f(1.0)));
 let texel=coord*${DEBUG_PIXEL_BLOCK};
 let a=textureLoad(debugPixels,texel,0);
 let b=textureLoad(debugPixels,texel+vec2i(1,0),0);
 let c=textureLoad(debugPixels,texel+vec2i(0,1),0);
 let d=textureLoad(debugPixels,texel+vec2i(1,1),0);
 if(d.y!=${DEBUG_PIXEL_KIND.surface}.0){
  if(vis.mode.y!=0u){return vec4f(0.04,0.04,0.06,1.0);}
  discard;
 }
 let mode=vis.mode.x;
 let frames=f32(textureLoad(filteredFrames,coord,0).x&0x7FFFFFFFu)/8.0;
 let historyKept=frames>1.0;
 let diffuseClamp=1.0-saturate(textureLoad(filteredDiffuse,coord,0).a);
 let specularClamp=1.0-saturate(textureLoad(filteredSpecular,coord,0).a);
 var shade=vec3f(b.w);
 if(mode==${V.shadingConfidence}u){shade=vec3f(textureLoad(shadingConfidence,coord,0).a);}
 else if(mode==${V.framesAccumulated}u){
  if(frames==0.0){shade=vec3f(1.0,0.0,0.0);}
  else if(frames<=1.0){shade=vec3f(1.0,1.0,0.0);}
  else{shade=vec3f((frames-1.0)/(vis.sizes.z-1.0));}
 }
 else if(mode==${V.upsampleMask}u){
  shade*=0.5;
  if(!historyKept){shade=vec3f(1.0,1.0,0.0);}
 }
 else if(mode==${V.diffuseDemodulate}u){shade=pow(b.xyz,vec3f(1.0/2.2));}
 else if(mode==${V.specularDemodulate}u){shade=pow(c.xyz,vec3f(1.0/2.2));}
 else if(mode==${V.diffuseStdDev}u||mode==${V.specularStdDev}u){
  let specular=mode==${V.specularStdDev}u;
  let filtered=(u32(a.w)&select(1u,2u,specular))!=0u;
  shade=vec3f(saturate(select(a.x,a.y,specular)));
  if(a.z>0.01&&filtered){shade=vec3f(0.6,0.0,1.0);}
  else if(filtered){shade=vec3f(0.0,0.0,1.0);}
  else if(a.z>0.01){shade=vec3f(saturate(a.z),0.0,0.0);}
 }
 else if(mode==${V.diffuseHistorySpatialStdDev}u||mode==${V.specularHistorySpatialStdDev}u){
  let deviation=select(c.w,d.x,mode==${V.specularHistorySpatialStdDev}u);
  shade=vec3f(deviation/(vis.sizes.w*2.0));
  if(deviation>vis.sizes.w){shade*=vec3f(0.0,0.0,1.0);}
 }
 else if(mode==${V.diffuseHistoryClamp}u||mode==${V.specularHistoryClamp}u){
  let clamped=select(diffuseClamp,specularClamp,mode==${V.specularHistoryClamp}u);
  shade=mix(shade*0.5,vec3f(1.0,0.0,0.0),clamped);
  if(clamped>=1.0){shade=vec3f(1.0,1.0,0.0);}
 }
 return vec4f(saturate(shade),1.0);
}`,
  [],
)
