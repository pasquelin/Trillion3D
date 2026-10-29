import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { colorMapTurbo } from '../../../../math/src/wgsl/turbo.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { PT_ADAPTIVE_UTILS_WGSL } from './adaptiveUtilsWgsl.ts'

/**
 * THE PATH TRACER'S DISPLAY (`ptDisplay`, drawn with the shared `fullscreen` vertex stage): the radiance of the pixel (the denoised one when the denoiser ran), scaled by the
 * view's pre-exposure, with the alpha turned to the frame's convention (1 less the tracer's) and held between 0 and 1. The depth of the frame is written as well (the reference's depth copy): the depth the
 * camera's rays accumulated, the nearest of the samples, in place of the one the raster left, so that what is drawn after the lit image (the translucent surfaces, the fog, the post process) works from the
 * tracer's own surfaces; a pixel whose rays escaped keeps the far plane's.
 * A component that overflowed half precision is held to its largest finite value. On top: the adaptive sampling's views (`adaptiveVisualize` 1 the pixels
 * still worked, coloured by the share of the samples they still need; 2 the sample count against the most; 3 and more a level of the error chain as its
 * perceptual error) and the progress bar of the samples gathered, which stays until the count is reached. The rainbow of the views is the shared `colorMapTurbo`
 * (`math/src/wgsl/turbo.ts`).
 */
export const PT_DISPLAY_WGSL = wgslBlock(
  'PT_DISPLAY_WGSL',
  [FULLSCREEN_VERTEX, PT_ADAPTIVE_UTILS_WGSL, colorMapTurbo],
  `struct PtDisplayView{
 bufferSize:vec2f,rectMin:vec2f,viewSize:vec2f,
 preExposure:f32,threshold:f32,
 iteration:u32,maxSamples:u32,progress:u32,visualize:i32}
@group(0) @binding(0) var<uniform> ptView:PtDisplayView;
@group(0) @binding(1) var ptRadiance:texture_2d<f32>;
@group(0) @binding(2) var ptVariance:texture_2d<f32>;
@group(0) @binding(3) var<uniform> ptVarianceDims:vec4u;
@group(0) @binding(4) var ptDepth:texture_2d<f32>;
struct PtDisplayOut{@location(0) colour:vec4f,@builtin(frag_depth) depth:f32,}
fn ptFinite(v:vec4f)->vec4f{
 let bits=bitcast<vec4u>(v);
 return select(vec4f(65504.0),v,(bits&vec4u(0x7f800000u))!=vec4u(0x7f800000u));
}
@fragment
fn ptDisplay(@builtin(position) at:vec4f)->PtDisplayOut{
 let uv=at.xy/ptView.bufferSize;
 let texel=vec2i(uv*ptView.bufferSize-ptView.rectMin);
 let radiance=ptFinite(textureLoad(ptRadiance,texel,0));
 var rgb=radiance.rgb*ptView.preExposure;
 let alpha=clamp(1.0-radiance.a,0.0,1.0);
 let dims=ptVarianceDims;
 let varianceUv=(vec2f(texel)+0.5)/vec2f(dims.xy);
 if(ptView.visualize==1){
  let factor=ptSampleFactor(vec2u(texel),ptView.threshold);
  if(factor>1.0){
   rgb=colorMapTurbo(textureLoad(ptVariance,texel,0).z*factor/f32(ptView.maxSamples));
  }
 }
 if(ptView.visualize==2){
  rgb=colorMapTurbo(textureLoad(ptVariance,texel,0).z/f32(min(ptView.iteration+1u,ptView.maxSamples)));
 }
 if(ptView.visualize>=3&&ptView.visualize<3+i32(dims.z)){
  let v=ptVarianceAt(varianceUv,ptView.visualize-3);
  let stdErr=sqrt((v.y-v.x*v.x)/v.z);
  rgb=vec3f(ptPerceptualError(v.x,stdErr));
 }
 let aspect=ptView.bufferSize.y/ptView.bufferSize.x;
 let size=50.0/ptView.bufferSize.x;
 let rectMax=ptView.rectMin+ptView.viewSize;
 let center=vec2f(mix(ptView.rectMin.x,rectMax.x,0.5),rectMax.y)/ptView.bufferSize.x-vec2f(0.0,size*0.75);
 let p=vec2f(uv.x,uv.y*aspect)-center;
 let barSize=vec2f(2.0*size,0.15*size);
 let q=(p+barSize)/(barSize*2.0);
 let edge=fwidth(q.x);
 let fraction=clamp(f32(ptView.iteration+1u)/f32(ptView.maxSamples),0.0,1.0);
 let blend=smoothstep(fraction-edge,fraction+edge,q.x);
 let inside=all(abs(p)<barSize)&&ptView.progress!=0u&&ptView.iteration+1u<ptView.maxSamples;
 if(inside){
  rgb=mix(rgb,mix(vec3f(1.0,0.1,0.1),vec3f(0.5),blend),0.75);
 }
 return PtDisplayOut(vec4f(rgb,alpha),textureLoad(ptDepth,texel,0).r);
}`,
)
