import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DITHER_WGSL, quantizationErrorsOf } from '../../post/taa/colorSpaceWgsl.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { SCREEN_SPACE_BINDINGS, SCREEN_SPACE_INPUTS_WGSL } from './rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from './screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from './screenSpaceView.ts'

/** The binding of the history the filter blends the new reflections with (the group's `color` is the new reflections, `out` the result, which is the next history). */
export const TEMPORAL_HISTORY_BINDING = 16

/** The blend of the history with each new image: one eighth. */
const HISTORY_BLEND = 8

/** The bindings of the history and of the result, the luma-chroma conversions, the history load and the filter's weights. */
const TEMPORAL_DECLARATIONS_TEXT = `@group(${SCREEN_SPACE_GROUP}) @binding(${TEMPORAL_HISTORY_BINDING}) var historyImage:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${SCREEN_SPACE_BINDINGS.out}) var temporalOut:texture_storage_2d<rgba16float,write>;
fn rgbToLuma(c:vec3f)->vec3f{return vec3f(dot(c,vec3f(1.0,2.0,1.0)),dot(c,vec3f(2.0,0.0,-2.0)),dot(c,vec3f(-1.0,2.0,-1.0)));}
fn lumaToRgb(c:vec3f)->vec3f{
 let q=c*0.25;
 return vec3f(q.x+q.y-q.z,q.x+q.z,q.x-q.y-q.z);
}
fn temporalLoad(p:vec2i)->vec4f{
 let size=vec2i(textureDimensions(colorImage));
 let c=-min(-textureLoad(colorImage,clamp(p,vec2i(0),size-vec2i(1)),0),vec4f(0.0));
 return vec4f(rgbToLuma(c.rgb),c.a);
}
fn catmullRom(x:f32)->f32{
 let a=abs(x);
 if(a>1.0){return ((-0.5*a+2.5)*a-4.0)*a+2.0;}
 return (1.5*a-2.5)*a*a+1.0;
}
fn kernelWeight(offset:vec2f)->f32{
 let d=(offset-ssView.temporal.xy)/ssView.blur.x;
 if(ssView.blur.y!=0.0){return catmullRom(d.x)*catmullRom(d.y);}
 return exp(-2.29*dot(d,d));
}
fn hdrWeight(luma:f32)->f32{return 1.0/(luma*ssView.blur.z+4.0);}
`

/** The kernel's start: the pixel and its four neighbours, and where the pixel stood in the last image. */
const TEMPORAL_MOTION_TEXT = `@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn temporalCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=ssView.size.xy)){return;}
 let pixel=vec2i(id.xy);
 let size=ssView.size.xy;
 let screen=ssScreenOfPixel(vec2f(pixel)+vec2f(0.5));
 let z=hizOpaqueDepth(pixel);
 let center=temporalLoad(pixel);
 let n1=temporalLoad(pixel+vec2i(0,-1));
 let n3=temporalLoad(pixel+vec2i(-1,0));
 let n5=temporalLoad(pixel+vec2i(1,0));
 let n7=temporalLoad(pixel+vec2i(0,1));
 // Where the pixel stood: the camera's motion, or its own vector.
 let prevClip=ssView.clipToPrevClip*vec4f(screen,z,1.0);
 var back=screen-prevClip.xy/prevClip.w;
 let vectorSize=vec2i(textureDimensions(colorVectors));
 let words=textureLoad(colorVectors,clamp(pixel,vec2i(0),vectorSize-vec2i(1)),0);
 if(hasOwnMotion(words.r)){back=decodeVector(words.r);}
 let pixels=back*size;
 let velocity=length(pixels);
 let blur=saturate(abs(pixels.x)*2.0+abs(pixels.y)*2.0);
 let historyScreen=screen-back;
 let offScreen=max(abs(historyScreen.x),abs(historyScreen.y))>=1.0;
 let ignoreHistory=offScreen||ssView.temporal.w!=0.0;
`

/** The filtered image (the plus of five, weighted), its box, and the history read there (bilinear, held within the view and the box). */
const TEMPORAL_FILTER_TEXT = ` // The filtered image: the plus of five, weighted, summing to one.
 let w1=kernelWeight(vec2f(0.0,-1.0));
 let w3=kernelWeight(vec2f(-1.0,0.0));
 let w4=kernelWeight(vec2f(0.0,0.0));
 let w5=kernelWeight(vec2f(1.0,0.0));
 let w7=kernelWeight(vec2f(0.0,1.0));
 var filtered=(n1*w1+n3*w3+center*w4+n5*w5+n7*w7)/(w1+w3+w4+w5+w7);
 let boxMin=min(min(min(n1,n3),min(center,n5)),n7);
 let boxMax=max(max(max(n1,n3),max(center,n5)),n7);
 // The history, held within the view.
 let limit=vec2f(1.0)-vec2f(1.0)/size;
 let historyUV=clamp(historyScreen,-limit,limit)*vec2f(0.5,-0.5)+vec2f(0.5);
 let historySize=vec2f(textureDimensions(historyImage));
 let at=historyUV*historySize-vec2f(0.5);
 let base=floor(at);
 let f=at-base;
 let last=vec2i(historySize)-vec2i(1);
 let h00=textureLoad(historyImage,clamp(vec2i(base),vec2i(0),last),0);
 let h10=textureLoad(historyImage,clamp(vec2i(base)+vec2i(1,0),vec2i(0),last),0);
 let h01=textureLoad(historyImage,clamp(vec2i(base)+vec2i(0,1),vec2i(0),last),0);
 let h11=textureLoad(historyImage,clamp(vec2i(base)+vec2i(1,1),vec2i(0),last),0);
 var history=mix(mix(h00,h10,f.x),mix(h01,h11,f.x),f.y);
 history=vec4f(rgbToLuma(history.rgb*ssView.temporal.z),history.a);
 let lumaMin=boxMin.x;
 let lumaMax=boxMax.x;
 history=clamp(history,boxMin,boxMax);
`

/** The aliasing taken back, the blend of the history with the filtered image, and the stochastic rounding into the history's format. */
const TEMPORAL_BLEND_TEXT = ` // The aliasing taken back where the history blurred the image.
 let contrast=lumaMax-lumaMin;
 let aliasing=saturate(saturate(blur)*0.5+1.0/(1.0+contrast*128.0));
 filtered=mix(filtered,center,aliasing);
 var blend=1.0/${HISTORY_BLEND}.0;
 if(ssView.temporal.w!=0.0){blend=1.0;}
 if(ignoreHistory){history=filtered;}
 let fw=hdrWeight(filtered.x);
 let hw=hdrWeight(history.x);
 let a=(1.0-blend)*hw;
 let b=blend*fw;
 let inverse=1.0/(a+b);
 var result=history*(a*inverse)+filtered*(b*inverse);
 if(result.a>0.995){result.a=1.0;}
 var rgb=lumaToRgb(result.xyz);
 rgb=-min(-rgb,vec3f(0.0));
 let stored=vec4f(min(rgb,vec3f(65504.0)),min(result.a,65504.0));
 // The stochastic rounding into the history's format, drawn per pixel and image.
 let rounded=ditherFloat(stored.rgb,frameRandom(pixel,ssView.frame.x).x,${quantizationErrorsOf('rgba16float')});
 textureStore(temporalOut,pixel,vec4f(rounded,stored.a));
}`

/**
 * THE TEMPORAL FILTER OF THE SCREEN REFLECTIONS (\`temporalCompute\`), one thread a pixel. The new reflections (\`colorImage\`, the group's colour)
 * and the history are read in a luma-chroma space whose luma is r + 2g + b. The pixel finds where it stood in the last image — the camera's
 * motion, or the surface's own vector where it moves by itself — and reads the history there, held within the view and bilinear, its light
 * scaled by the change of exposure. The new image is filtered by the plus of the pixel and its four neighbours, weighted by a Gaussian (or
 * a Catmull-Rom) of their distance from the image's jitter. The history is clamped to the box of those five, and the filtered image
 * takes back some of the unfiltered centre where the history blurred it (the share of sub-pixel motion, over the contrast the box holds). The two
 * are then blended, one eighth the new one (whole after a camera cut), each weighted by one over its luma
 * scaled plus 4. A pixel that moved too far to find its history, or a camera cut, takes the filtered image alone. The result keeps the alpha and is rounded stochastically into the history's half floats.
 */
export const temporalWgsl = () =>
  wgslProgram(
    TEMPORAL_DECLARATIONS_TEXT + TEMPORAL_MOTION_TEXT + TEMPORAL_FILTER_TEXT + TEMPORAL_BLEND_TEXT,
    [SCREEN_SPACE_INPUTS_WGSL, VECTOR_CODEC_WGSL, DITHER_WGSL],
  )
