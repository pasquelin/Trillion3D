import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { DENOISE_BINDINGS as D } from '../../screenSpaceTracing/denoise/denoiseView.ts'
import { STACKOWIAK_WGSL } from '../../screenSpaceTracing/denoise/stackowiakSet.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../../screenSpaceTracing/rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../../screenSpaceTracing/screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from '../../screenSpaceTracing/screenSpaceView.ts'
import { OCCLUSION_DENOISE_COMMON_WGSL } from './shadowDenoiseCommonWgsl.ts'
import { OUT_HISTORY } from './shadowDenoiseSpatialWgsl.ts'
import { historyWgsl } from './shadowDenoiseTemporalWgsl.ts'
import { STACKOWIAK_SECOND_WGSL } from './stackowiakSecond.ts'

const G = SCREEN_SPACE_GROUP
const SIDE = SCREEN_SPACE_GROUP_SIDE

/** The weight the diffuse signal's history is kept up to, in samples (the signal is a diffuse light, which asks a large kernel to clean). */
export const DIFFUSE_TARGETED_SAMPLES = 4096
/** The distance an input texel with no hit stands for, in metres: far enough that the plane test of the reconstruction lets everything through. */
const FAR = '1.0e20'

/**
 * THE DIFFUSE SIGNAL'S SAMPLE AND ITS BILATERAL WEIGHT, over the occlusion's parts (`OCCLUSION_DENOISE_COMMON_WGSL`: the surface of a pixel of this image or of the one before, the plane-and-normals weight
 * `sdHistoryWeight`, which is the diffuse preset's):
 *  - a texel of the signal is two textures: the mean colour (red, green, blue) with the share of the rays that hit (alpha), and the weight of the sample (the number of rays it stands for);
 *  - a sample (`DfSample`) is held as sums, never averaged until it is written: its weight `n` and its colour with the hit share, all times the weight;
 *  - `dfPlane(base, nb, reach)`: the weight of a neighbour for the pixel, its distance to the pixel's plane within `reach`, the normals' agreement.
 */
const DIFFUSE_PARTS = wgslBlock(
  'SD_DIFFUSE_PARTS_WGSL',
  [OCCLUSION_DENOISE_COMMON_WGSL],
  `@group(${G}) @binding(${B.outSecond}) var outB:texture_storage_2d<r32float,write>;
struct DfSample{n:f32,c:vec4f,}
fn dfZero()->DfSample{return DfSample(0.0,vec4f(0.0));}
fn dfAdd(a:DfSample,b:DfSample)->DfSample{return DfSample(a.n+b.n,a.c+b.c);}
fn dfScale(a:DfSample,w:f32)->DfSample{return DfSample(a.n*w,a.c*w);}
/** The sample a denoising pass wrote at a texel of the image (clamped to the rect the pass works over). */
fn dfTap(texel:vec2i)->DfSample{
 let t=clamp(texel,vec2i(dnParams.rect.xy),vec2i(dnParams.rect.zw)-vec2i(1));
 let n=textureLoad(sourceB,t,0).r;
 return DfSample(n,textureLoad(sourceA,t,0)*n);
}
/** A sample written: its mean colour (held in the range of a half float) with the hit share, and its weight. */
fn dfStore(at:vec2i,s:DfSample){
 let k=safeRcp(s.n);
 textureStore(outA,at,vec4f(min(s.c.rgb*k,vec3f(DN_MAX_HALF)),s.c.a*k));
 textureStore(outB,at,vec4f(s.n,0.0,0.0,0.0));
}
fn dfPlane(base:SdSurface,nb:SdSurface,reach:f32)->f32{return sdHistoryWeight(sdLight(),max(reach,1e-6),base,nb);}
/** The reach of two pixels' surfaces: twice the root of two of the smaller of their pixels' radii. */
fn dfPixelReach(base:SdSurface,nb:SdSurface)->f32{return sdAmend(min(ssPixelRadius(nb.depth),ssPixelRadius(base.depth)));}
/** A tap of the pass's own grid (full resolution), weighed against the surface under it within the pixels' reach. */
fn dfTakeNear(acc:ptr<function,DfSample>,base:SdSurface,pos:vec2f){
 if(sdOutside(pos)){return;}
 let texel=vec2i(floor(pos));
 let s=dfTap(texel);
 if(s.n==0.0){return;}
 *acc=dfAdd(*acc,dfScale(s,dfPlane(base,sdSurfaceAt(texel),dfPixelReach(base,sdSurfaceAt(texel)))));
}`,
)

/** The pixel the rays of texel `texel` of the rays' grid were cast from this image: its cell's pixel the image's turn picks (the parameters' spread w, the frame modulo the cell's pixel count). */
const RAY_PIXEL_WGSL = wgslBlock(
  'SD_DIFFUSE_RAY_PIXEL_WGSL',
  [DIFFUSE_PARTS],
  `
fn dfUpscale()->u32{return max(u32(dnParams.grid.z),1u);}
fn dfTurn()->u32{return u32(dnParams.spread.w)%(dfUpscale()*dfUpscale());}
fn dfRayPixel(texel:vec2i)->vec2i{
 let up=dfUpscale();
 let turn=dfTurn();
 return texel*i32(up)+vec2i(i32(turn%up),i32(turn/up));
}`,
)

/**
 * THE RECONSTRUCTION OF THE DIFFUSE SIGNAL (`diffuseReconstruct`, a thread a pixel of the full-resolution image): the pixel's sample from the rays' grid (the source: the light with its hit share, and the
 * distance of the hits with the rays a pixel, which the trace wrote, one texel for `grid.z` pixels a side, the pixel of the cell it was cast from changing with the image).
 *  - the taps: the quad-shared stochastic sets (the first subset), the pixel's quad taking its track, in texels of the rays' grid: the centre first, the set's second offset, then pairs up to the
 *    most samples (`spread.x`, at most 256); where the grid is the image's (`grid.z` 1) the centre is the quad's own corner and the first tap the pixel itself; where it is coarser the centre is the ray
 *    nearest the pixel (the cell found from the pixel less half a cell, the cell's pixel added), the track the quad's turned over, and the centre whole where the pixel is the one cast this image;
 *  - a tap weighs its plane distance to the pixel's surface within the distance its own rays' hits were found at (a ray that hit nothing: no bound), times the normals' agreement; the surface a tap is
 *    taken against is the one under the pixel its rays were cast from.
 * The sample is the sum of the taps, written as the mean colour with its weight.
 */
export const diffuseReconstructWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
struct DfInput{s:DfSample,hit:f32,pixel:vec2i,}
fn dfInput(texel:vec2i)->DfInput{
 let t=clamp(texel,vec2i(0),vec2i(textureDimensions(sourceA))-vec2i(1));
 let a=textureLoad(sourceA,t,0);
 let b=textureLoad(sourceB,t,0);
 return DfInput(DfSample(b.g,a*b.g),select(b.r,${FAR},b.r<0.0),dfRayPixel(t));
}
fn dfTake(acc:ptr<function,DfSample>,base:SdSurface,pos:vec2f,force:bool){
 if(sdOutside(pos*f32(dfUpscale()))){return;}
 let v=dfInput(vec2i(floor(pos)));
 if(v.s.n==0.0){return;}
 var w=1.0;
 if(!force){w=dfPlane(base,sdSurfaceAt(v.pixel),v.hit);}
 *acc=dfAdd(*acc,dfScale(v.s,w));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn diffuseReconstruct(@builtin(global_invocation_id) gid:vec3u){
 let id=sdPixelOf(gid.xy);
 if(any(id>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id);
 let up=dfUpscale();
 let base=sdSurfaceAt(at);
 let total=clamp(u32(dnParams.spread.x),1u,256u);
 var acc=dfZero();
 var centre:vec2f;
 var track:u32;
 if(up==1u){
  centre=vec2f(id|vec2u(1u));
  track=(id.x&1u)|((id.y&1u)<<1u);
  dfTake(&acc,base,vec2f(id)+vec2f(0.5),true);
 }else{
  let turn=dfTurn();
  let ray=vec2u(turn%up,turn/up);
  let cell=floor((vec2f(id)-vec2f(f32(up/2u)))/f32(up));
  centre=cell+vec2f(0.5)+(vec2f(ray)+vec2f(0.5))/f32(up);
  track=((id.x&1u)|((id.y&1u)<<1u))^3u;
  dfTake(&acc,base,centre,all(id%vec2u(up)==ray));
 }
 dfTake(&acc,base,centre+stackowiak[4u+track],false);
 for(var b=0u;b<(total-1u)/2u;b++){
  let first=2u+2u*b;
  dfTake(&acc,base,centre+stackowiak[4u*first+track],false);
  dfTake(&acc,base,centre+stackowiak[4u*(first+1u)+track],false);
 }
 dfStore(at,acc);
}`,
    [DIFFUSE_PARTS, RAY_PIXEL_WGSL, STACKOWIAK_WGSL],
  )

/** The rings of the pre-convolution's hexagonal web (a ring r is r times the spread from the centre, 3r pairs of samples). */
const WEB_RINGS = 1

/**
 * THE PRE-CONVOLUTION OF THE DIFFUSE SIGNAL (`diffusePreConvolve`, a thread a pixel): the pixel's own sample whole, with the six samples of a hexagonal web of one ring about the pixel's centre moved by
 * noise within the spread (the parameters' spread z, 8 pixels doubling with each pass), each weighed by its plane distance within the pixels' reach and the normals' agreement; the sum is written.
 */
export const diffusePreConvolveWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
@compute @workgroup_size(${SIDE},${SIDE})
fn diffusePreConvolve(@builtin(global_invocation_id) gid:vec3u){
 let id=sdPixelOf(gid.xy);
 if(any(id>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id);
 let base=sdSurfaceAt(at);
 var acc=dfTap(at);
 let spread=dnParams.spread.z;
 let noise=vec2f(interleavedGradientNoise(vec2f(id),0.0),interleavedGradientNoise(vec2f(id),1.0));
 let jittered=vec2f(id)+vec2f(0.5)+(noise-vec2f(0.5))*spread;
 let pairs=3u*${WEB_RINGS}u;
 let step=3.14159265/f32(pairs);
 var angle=3.14159265*0.2/f32(pairs);
 for(var k=0u;k<pairs;k++){
  angle+=step;
  let offset=vec2f(cos(angle),sin(angle))*f32(${WEB_RINGS})*spread;
  dfTakeNear(&acc,base,jittered+offset);
  dfTakeNear(&acc,base,jittered-offset);
 }
 dfStore(at,acc);
}`,
    [DIFFUSE_PARTS, interleavedGradientNoise],
  )

/** The neighbourhood the history is bounded by: the seven by seven pixels about the pixel. */
const REJECTION_RADIUS = 3

/**
 * THE ACCUMULATION IN TIME OF THE DIFFUSE SIGNAL (`diffuseTemporal`, a thread a pixel): the pre-convolved sample of this image (the source) blended with the history, the last image's result.
 *  - where the pixel stood and the history gathered there, as the shadow's (`historyWgsl`): the four texels around the place, each weighed by its bilinear share and by its plane distance and normals'
 *    agreement against the surface the last image kept there, within three times the smaller of the two pixels' reach; the colour times the pre-exposure's change since;
 *  - its rejection: the neighbourhood's mean colours (each sample brought to one) over the seven by seven pixels about the pixel, each weighed by its plane distance within the pixel's own reach, give a
 *    box (the least and the greatest of those that weighed) which the history's mean colour is brought into; no sample in the neighbourhood (weighed or not, the pixel's own whole when it has one, all of
 *    them whole where it has none) leaves no history;
 *  - the blend: the history is kept up to the weight the signal is held to (`DIFFUSE_TARGETED_SAMPLES`) less the sample's, the sum is the result.
 */
export const diffuseTemporalWgsl = () =>
  wgslProgram(
    `@group(${G}) @binding(${D.historyB}) var historyB:texture_2d<f32>;
fn dfHistory(base:SdSurface,uv:vec2f)->DfSample{
 let size=vec2i(dnParams.previous.xy);
 let spot=uv*vec2f(size)-vec2f(0.5);
 let top=vec2i(floor(spot));
 let f=spot-floor(spot);
 var sum=dfZero();
 for(var i=0;i<4;i++){
  let offset=vec2i(i&1,i>>1);
  let texel=top+offset;
  if(any(texel<vec2i(0))||any(texel>=size)||any(texel<vec2i(dnParams.lastRect.xy))||any(texel>=vec2i(dnParams.lastRect.zw))){continue;}
  let n=textureLoad(historyB,texel,0).r;
  if(n==0.0){continue;}
  let near=sdSurfacePrev(texel);
  if(near.flags==SD_SURFACE_LOST){continue;}
  let bilinear=select(1.0-f.x,f.x,offset.x==1)*select(1.0-f.y,f.y,offset.y==1);
  let w=bilinear*dfPlane(base,near,dfPixelReach(base,near)*3.0);
  sum=dfAdd(sum,dfScale(DfSample(n,textureLoad(historyA,texel,0)*n),w));
 }
 return sum;
}
@compute @workgroup_size(${SIDE},${SIDE})
fn diffuseTemporal(@builtin(global_invocation_id) gid:vec3u){
 let id=sdPixelOf(gid.xy);
 if(any(id>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id);
 let base=sdSurfaceAt(at);
 let current=dfTap(at);
 // Where the pixel stood in the last image, and the history there, its colour in this image's exposure.
 let place=sdPlace(at);
 var history=dfZero();
 if(place.w>0.0){
  history=dfHistory(base,place.xy);
  history.c=vec4f(history.c.rgb*dnParams.time.y,history.c.a);
 }
 // The box of the neighbourhood: the least and the greatest mean colour.
 var low=vec4f(3.0e38);
 var high=vec4f(0.0);
 var seen=false;
 if(current.n>0.0){
  let mean=current.c*safeRcp(current.n);
  low=min(low,mean);
  high=max(high,mean);
  seen=true;
 }
 let reach=sdAmend(ssPixelRadius(base.depth));
 for(var k=0;k<${(2 * REJECTION_RADIUS + 1) ** 2};k++){
  let x=k%${2 * REJECTION_RADIUS + 1}-${REJECTION_RADIUS};
  let y=k/${2 * REJECTION_RADIUS + 1}-${REJECTION_RADIUS};
  if(x==0&&y==0){continue;}
  let pos=vec2f(at)+vec2f(0.5)+vec2f(f32(x),f32(y));
  if(sdOutside(pos)){continue;}
  let texel=vec2i(floor(pos));
  let s=dfTap(texel);
  if(s.n==0.0){continue;}
  var w=1.0;
  if(current.n>0.0){w=dfPlane(base,sdSurfaceAt(texel),reach);}
  if(w>0.0){
   let mean=s.c*safeRcp(s.n);
   low=min(low,mean);
   high=max(high,mean);
   seen=true;
  }
 }
 if(seen){
  let held=history.c*safeRcp(history.n);
  history.c=clamp(held,low,high)*history.n;
 }else{
  history=dfZero();
 }
 // The blend.
 let kept=min(history.n,${DIFFUSE_TARGETED_SAMPLES}.0-current.n);
 let scale=select(0.0,kept/history.n,history.n>0.0);
 dfStore(at,dfAdd(dfScale(history,scale),current));
}`,
    [DIFFUSE_PARTS, historyWgsl(true)],
  )

/**
 * THE CONVOLUTION OF THE DIFFUSE HISTORY (`diffusePostFilter`, a thread a pixel): the pixel's own sample whole with the taps of the second subset of the quad-shared sets about the quad's centre (the
 * spread in the parameters' z), as many as the history's weight asks (`DIFFUSE_TARGETED_SAMPLES` over it, from 1 to the most samples in the parameters' x, a quarter of them for the four sets), each
 * weighed by its plane distance within the pixels' reach and the normals' agreement. The sum is written, and is the history the next image reads.
 */
export const diffusePostFilterWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
@compute @workgroup_size(${SIDE},${SIDE})
fn diffusePostFilter(@builtin(global_invocation_id) gid:vec3u){
 let id=sdPixelOf(gid.xy);
 if(any(id>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id);
 let base=sdSurfaceAt(at);
 var acc=dfTap(at);
 let most=max(u32(dnParams.spread.x),1u);
 var asked=f32(most);
 if(acc.n>0.0){asked=clamp(${DIFFUSE_TARGETED_SAMPLES}.0/acc.n,1.0,f32(most));}
 let total=clamp(u32(asked)/4u,1u,most);
 let spread=dnParams.spread.z;
 let centre=vec2f(id|vec2u(1u));
 let track=(id.x&1u)|((id.y&1u)<<1u);
 dfTakeNear(&acc,base,centre+stackowiakSecond[4u+track]*spread);
 for(var b=0u;b<(total-1u)/2u;b++){
  let first=2u+2u*b;
  dfTakeNear(&acc,base,centre+stackowiakSecond[4u*first+track]*spread);
  dfTakeNear(&acc,base,centre+stackowiakSecond[4u*(first+1u)+track]*spread);
 }
 dfStore(at,acc);
}`,
    [DIFFUSE_PARTS, STACKOWIAK_SECOND_WGSL],
  )

/** THE OUTPUT OF THE DIFFUSE SIGNAL (`diffuseFinal`, a thread a pixel): the mean colour of the accumulated sample, none where it has no weight, into the texture the sky light composites from. */
export const diffuseFinalWgsl = () =>
  wgslProgram(
    `${OUT_HISTORY}
@compute @workgroup_size(${SIDE},${SIDE})
fn diffuseFinal(@builtin(global_invocation_id) gid:vec3u){
 let id=sdPixelOf(gid.xy);
 if(any(id>=vec2u(dnParams.rect.zw))){return;}
 let at=vec2i(id);
 let v=textureLoad(sourceA,at,0);
 textureStore(outA,at,vec4f(select(vec3f(0.0),v.rgb,textureLoad(sourceB,at,0).r>0.0),0.0));
}`,
    [OCCLUSION_DENOISE_COMMON_WGSL],
  )
