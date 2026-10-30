import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslVariants } from '../../../../../math/src/wgsl/decl.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'
import { DENOISE_BINDINGS as D } from '../../screenSpaceTracing/denoise/denoiseView.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../../screenSpaceTracing/rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../../screenSpaceTracing/screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from '../../screenSpaceTracing/screenSpaceView.ts'
import { denoiseCommonOf } from './shadowDenoiseCommonWgsl.ts'

const G = SCREEN_SPACE_GROUP
const SIDE = SCREEN_SPACE_GROUP_SIDE

/** The most standard deviations the history may stray from its neighbourhood's mean by, and the share of a sample a neighbourhood that holds one leaves the history at least. */
const DEVIATIONS = 1.25
const LEAST_HISTORY = 0.1

/** The history's part of the accumulation, for either signal (the common parts of the signal it is made for): the bindings of the history, of the surface the last image kept and of the result; the surface the
 *  last image kept at a texel, the place the pixel stood in it, and the history gathered there, each tap weighed by the signal's `sdHistoryWeight`. */
export const historyWgsl = wgslVariants((occlusion: boolean) =>
  wgslBlock(
    `SD_HISTORY_WGSL(${occlusion ? 'occlusion' : 'shadow'})`,
    [denoiseCommonOf(occlusion ? 'occlusion' : 'shadow'), VECTOR_CODEC_WGSL],
    `@group(${G}) @binding(${D.historyA}) var historyA:texture_2d<f32>;
@group(${G}) @binding(${D.prevDepth}) var prevDepth:texture_2d<f32>;
@group(${G}) @binding(${D.prevNormals}) var prevNormals:texture_2d<f32>;
@group(${G}) @binding(${B.out}) var outA:texture_storage_2d<rgba16float,write>;
/** The surface the last image kept at a texel of it: its point (in this image's world), depth and normal. */
fn sdSurfacePrev(texel:vec2i)->SdSurface{
 let size=vec2i(dnParams.previous.xy);
 let p=clamp(texel,vec2i(0),size-vec2i(1));
 let z=max(textureLoad(prevDepth,p,0).r,1e-8);
 let uv=(vec2f(p)+vec2f(0.5))/vec2f(size);
 let clip=ssView.prevClipToWorld*vec4f(uv*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),z,1.0);
 // A point behind the last image's eye has no place in the world: its surface is marked, and the history there is not read.
 if(clip.w<=1e-8){return SdSurface(vec3f(0.0),0.0,vec3f(0.0,0.0,1.0),SD_SURFACE_LOST);}
 return SdSurface(clip.xyz/clip.w,ssSceneDepth(z),normalize(textureLoad(prevNormals,p,0).xyz),0u);
}
/** The history at a place of the last image (a texture coordinate): the sum of the bilinear taps' samples, each weighed by its bilateral weight (x the count, y the share that arrived). */
fn sdHistory(light:SdLight,base:SdSurface,uv:vec2f)->vec2f{
 let size=vec2i(dnParams.previous.xy);
 let spot=uv*vec2f(size)-vec2f(0.5);
 let top=vec2i(floor(spot));
 let f=spot-floor(spot);
 var sum=vec2f(0.0);
 for(var i=0;i<4;i++){
  let offset=vec2i(i&1,i>>1);
  let texel=top+offset;
  if(any(texel<vec2i(0))||any(texel>=size)||any(texel<vec2i(dnParams.lastRect.xy))||any(texel>=vec2i(dnParams.lastRect.zw))){continue;}
  let h=textureLoad(historyA,texel,0);
  if(h.g==0.0){continue;}
  let near=sdSurfacePrev(texel);
  if(near.flags==SD_SURFACE_LOST){continue;}
  let reach=sdAmend(min(ssPixelRadius(near.depth),ssPixelRadius(base.depth)))*3.0;
  let bilinear=select(1.0-f.x,f.x,offset.x==1)*select(1.0-f.y,f.y,offset.y==1);
  let w=bilinear*sdHistoryWeight(light,reach,base,near);
  sum+=vec2f(h.g*w,h.r*h.g*w);
 }
 return sum;
}
/** Where the pixel stood in the last image: its texture coordinate (xy), the depth it had there (z) and whether that place holds a history (w, 1): the point lies in front of the last image's eye and inside its
 *  view, the image has a history (the parameters' grid w) and the pixel's motion is the camera's, or the surface's own vector where it moves by itself. */
fn sdPlace(at:vec2i)->vec4f{
 let screen=ssScreenOfPixel(vec2f(at)+vec2f(0.5));
 let z=hizOpaqueDepth(at);
 let prevClip=ssView.clipToPrevClip*vec4f(screen,z,1.0);
 // A point behind the last image's eye has no place in it: none of its history is read.
 var placed=prevClip.w>1e-8;
 var back=select(vec2f(0.0),screen-prevClip.xy/prevClip.w,placed);
 let words=textureLoad(colorVectors,clampToExtent(at,vec2i(textureDimensions(colorVectors))),0);
 if(hasOwnMotion(words.r)){back=decodeVector(words.r);placed=true;}
 let uv=(screen-back)*vec2f(0.5,-0.5)+vec2f(0.5);
 let edge=vec2f(0.5)/dnParams.previous.xy;
 let inside=placed&&dnParams.grid.w==0.0&&all(uv>=edge)&&all(uv<=vec2f(1.0)-edge);
 return vec4f(uv,select(z,prevClip.z/prevClip.w,prevClip.w>1e-8),select(0.0,1.0,inside));
}`,
  ),
)

/**
 * THE ACCUMULATION IN TIME (`shadowTemporal`, a thread a pixel): the pre-convolved sample of this image (the source, taken as one sample) blended with the history, the last image's result.
 *  - where the pixel stood: its point projected into the last image (read over the extent it was drawn at, the parameters' previous, which a size change moves) by the camera's motion, or by the surface's own vector where it moves by itself; none off the view or after a cut (the
 *    parameters' grid w);
 *  - the history is the four texels around that place, each weighed by its bilinear share and by its bilateral weight (`sdBilateral`) against the surface the last image kept there, within three times
 *    the greater of the two pixels' reach, as the sum of their samples;
 *  - its rejection: the pixel's share and its eight neighbours' (each weighed by the sample's radius) give a mean and a deviation of the share that arrived; the history's share is brought into the
 *    mean plus or minus 1.25 deviations, the history keeps the weight it had less what the bringing moved the share by, and a tenth of a sample at least where the neighbourhood holds one;
 *  - the blend: the history is kept up to the weight the pixel's reach asks for (the penumbra's radius over the pixel's, squared, times the tolerated noise, from 1 to 1024) less the sample's, the sum is the result,
 *    written with the least radius of the pixel and its neighbours.
 */
export const shadowTemporalWgsl = () =>
  wgslProgram(
    `@compute @workgroup_size(${SIDE},${SIDE})
fn shadowTemporal(@builtin(global_invocation_id) gid:vec3u){
 let id=vec3u(sdPixelOf(gid.xy),0u);
 if(any(id.xy>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id.xy);
 let light=sdLight();
 let base=sdSurfaceAt(at);
 let current=sdTap(at);
 let currentN=select(0.0,1.0,current.n>0.0);
 let currentShare=select(0.0,current.m/current.n,current.n>0.0);
 // Where the pixel stood in the last image.
 let place=sdPlace(at);
 var history=vec2f(0.0);
 if(place.w>0.0){history=sdHistory(light,base,place.xy);}
 // The neighbourhood of the pixel in this image: the mean and the deviation of the share that arrived.
 var m1=vec2f(0.0);
 var m2=vec2f(0.0);
 var least=SD_RADIUS_MISS;
 if(current.n>0.0){
  m1+=vec2f(1.0,currentShare);
  m2+=vec2f(1.0,currentShare*currentShare);
  if(current.r!=SD_RADIUS_INVALID){least=min(least,current.r);}
 }
 for(var i=0;i<8;i++){
  let k=select(i,i+1,i>=4);
  let texel=at+vec2i(k%3-1,k/3-1);
  if(sdOutside(vec2f(texel)+vec2f(0.5))){continue;}
  let s=sdTap(texel);
  if(s.n==0.0){continue;}
  let w=sdBilateral(light,s.r,base,sdSurfaceAt(texel));
  let share=s.m/s.n;
  m1+=vec2f(1.0,share)*w;
  m2+=vec2f(1.0,share*share)*w;
  if(w>0.0&&s.r!=SD_RADIUS_INVALID){least=min(least,s.r);}
 }
 let norm=safeRcp(m1.x);
 let mean=m1*norm;
 let deviation=sqrt(abs(m2*norm-mean*mean));
 let low=mean-${DEVIATIONS}*deviation;
 let high=mean+${DEVIATIONS}*deviation;
 let held=select(0.0,history.y/history.x,history.x>0.0);
 let brought=clamp(held,low.y,high.y);
 var weight=history.x*saturate(1.0-abs(brought-held));
 // A pixel with no history (a cut, off the last image) gets none made up: the least weight only keeps a history from vanishing wholly.
 if(history.x>0.0){weight=max(weight,mean.x*${LEAST_HISTORY});}
 // The blend.
 let radius=min(current.r,least);
 let reach=radius/ssPixelRadius(base.depth)*0.5;
 let targeted=clamp(reach*reach*(3.14159265*0.25/(9.0*1.4142136)),1.0,1024.0);
 let kept=min(weight,targeted-currentN);
 let scale=select(0.0,kept/weight,weight>0.0);
 textureStore(outA,at,sdEncode(weight*scale+currentN,brought*weight*scale+currentN*currentShare,radius));
}`,
    [denoiseCommonOf('shadow'), historyWgsl(false)],
  )
