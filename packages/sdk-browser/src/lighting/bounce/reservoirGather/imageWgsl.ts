import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import {
  computeStorageEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import {
  FRAMES_FORMAT,
  LIGHT_FORMAT,
  RESERVOIR_BINDINGS,
  RESERVOIR_PAST_WGSL,
  RESERVOIR_WGSL,
} from './commonWgsl.ts'

const B = RESERVOIR_BINDINGS

/** The entry points of the kernels that work on the pixels. */
export const IMAGE_ENTRIES = {
  upsample: 'reservoirUpsample',
  accumulate: 'reservoirAccumulate',
  bilateral: 'reservoirBilateral',
} as const

/** The layout of the pixel kernels' group 0: the resampling kernels' bindings, the textures of light read (the upsampling's, the last image's accumulation) and the three written. */
export const imageEntries = () => [
  computeUniformEntry(B.params, { hasDynamicOffset: true }),
  computeTextureEntry(B.blue, 'float'),
  computeStorageEntry(B.poolA, true),
  computeStorageEntry(B.poolB, true),
  computeTextureEntry(B.normals, 'float'),
  computeTextureEntry(B.vectors, 'uint'),
  computeTextureEntry(B.lightIn, 'unfilterable-float'),
  computeTextureEntry(B.restIn, 'unfilterable-float'),
  computeTextureEntry(B.historyLight, 'unfilterable-float'),
  computeTextureEntry(B.historyRest, 'unfilterable-float'),
  computeTextureEntry(B.historyFrames, 'unfilterable-float'),
  computeStorageTextureEntry(B.lightOut, LIGHT_FORMAT),
  computeStorageTextureEntry(B.restOut, LIGHT_FORMAT),
  computeStorageTextureEntry(B.framesOut, FRAMES_FORMAT),
]

/** The textures of light the pixel kernels read and write. */
const IMAGE_TEXTURES_WGSL = wgslBlock(
  'RESERVOIR_IMAGE_TEXTURES_WGSL',
  [],
  `@group(0) @binding(${B.lightIn}) var lightIn:texture_2d<f32>;
@group(0) @binding(${B.restIn}) var restIn:texture_2d<f32>;
@group(0) @binding(${B.historyLight}) var historyLight:texture_2d<f32>;
@group(0) @binding(${B.historyRest}) var historyRest:texture_2d<f32>;
@group(0) @binding(${B.historyFrames}) var historyFrames:texture_2d<f32>;
@group(0) @binding(${B.lightOut}) var lightOut:texture_storage_2d<${LIGHT_FORMAT},write>;
@group(0) @binding(${B.restOut}) var restOut:texture_storage_2d<${LIGHT_FORMAT},write>;
@group(0) @binding(${B.framesOut}) var framesOut:texture_storage_2d<${FRAMES_FORMAT},write>;`,
)

/** The variance a pixel the last image could not explain starts at: above every variance the upsampling gives, which is held under it less a tenth. */
const DISOCCLUSION_VARIANCE = 1

/**
 * WHAT A RESERVOIR GIVES A PIXEL (`rsGive`): its sample's light times its weight is the light the ray stands for; the diffuse is that times the cosine of the sample's direction with the normal, the rough
 * specular that times the GGX lobe of the half vector (the roughness, held to a hundredth, to the fourth as its width, the implicit visibility, a quarter), tonemapped by its luminance so that a bright sample does not
 * drown the others (`rsTonemap`, `rsUntonemap`, which holds the divisor off zero where the tonemapped luminance rounds to one).
 */
const GIVE_WGSL = wgslBlock(
  'RESERVOIR_GIVE_WGSL',
  [],
  `struct RsGive{light:vec3f,diffuse:vec3f,rest:vec3f,}
fn rsTonemap(c:vec3f)->vec3f{return c/(1.0+rsLuma(c));}
fn rsUntonemap(c:vec3f)->vec3f{return c/max(1.0-rsLuma(c),0.000001);}
fn rsGive(r:RsReservoir,N:vec3f,V:vec3f,rough:f32)->RsGive{
 let light=r.s.radiance*r.w;
 let H=normalize(V+r.s.dir);
 let noh=saturate(dot(N,H));
 let r=max(rough,0.01);
 let a2=r*r*r*r;
 let d=noh*noh*(a2-1.0)+1.0;
 let ggx=a2/(3.14159265*d*d);
 return RsGive(light,light*max(dot(N,r.s.dir),0.0),rsTonemap(light*(ggx*0.25)));
}
/** The running mean and sum of squares of the luminance of the lights, weighted (the weighted incremental algorithm). */
struct RsVariance{total:f32,mean:f32,s:f32,}
fn rsVary(v:RsVariance,light:vec3f,weight:f32)->RsVariance{
 var o=v;
 o.total+=weight;
 let luma=rsLuma(light);
 let was=o.mean;
 o.mean+=weight/o.total*(luma-was);
 o.s+=weight*(luma-was)*(luma-o.mean);
 return o;
}`,
)

/** The four reservoirs round a pixel and their weights (`rsUniformTaps`): bilinear in the reservoir grid, by the jittered place, each by how close its surface lies to the pixel's plane. */
const TAPS_WGSL = wgslBlock(
  'RESERVOIR_TAPS_WGSL',
  [],
  `struct RsTaps{coord:array<vec2u,4>,weights:vec4f,}
fn rsUniformTaps(px:vec2f,offset:vec2f,P:vec3f,depth:f32,N:vec3f)->RsTaps{
 let jitter=vec2f(vec2u(hammersley16(rs.size.w,8u,vec2u(0u))*f32(rs.size.z)));
 let full=vec2u(clamp(px-jitter+offset,vec2f(0.0),view.viewport.xy-vec2f(1.0)));
 let tile=min(full/rs.size.z,max(rs.size.xy,vec2u(2u))-vec2u(2u));
 let bilinear=(vec2f(full)-vec2f(tile*rs.size.z)+vec2f(1.0))/f32(rs.size.z+2u);
 var taps:RsTaps;
 taps.coord=array<vec2u,4>(tile,tile+vec2u(1u,0u),tile+vec2u(0u,1u),tile+vec2u(1u,1u));
 let interpolation=vec4f((1.0-bilinear.y)*(1.0-bilinear.x),(1.0-bilinear.y)*bilinear.x,bilinear.y*(1.0-bilinear.x),bilinear.y*bilinear.x);
 var depthWeights=vec4f(0.0);
 for(var i=0u;i<4u;i++){
  let corner=rsLoad(rs.sets.x,taps.coord[i]);
  if(corner.depth>0.0){
   let distance=abs(dot(rsWorld(taps.coord[i],rs.size.w,corner.depth),N)-dot(P,N));
   let relative=distance/depth;
   depthWeights[i]=exp2(-10000.0*relative*relative);
  }
 }
 taps.weights=interpolation*depthWeights;
 return taps;
}`,
)

const UPSAMPLE_KERNEL_WGSL = `/** A pixel's light from the reservoirs round it, by the method asked (the jittered bilinear read, the spiral, the nearest reservoir alone), written with whether it answered and the variance of what it read. */
@compute @workgroup_size(8,8)
fn ${IMAGE_ENTRIES.upsample}(@builtin(global_invocation_id) id:vec3u){
 let px=id.xy;
 if(any(px>=vec2u(view.viewport.xy))){return;}
 let m=rsMaterial(px);
 if(!m.valid){
  textureStore(lightOut,vec2i(px),vec4f(0.0));
  textureStore(restOut,vec2i(px),vec4f(0.0));
  return;
 }
 let V=viewToEye(m.P);
 let planeD=dot(m.P,m.N);
 let method=u32(rs.upsample.x);
 var diffuse=vec3f(0.0);
 var rest=vec3f(0.0);
 var vary=RsVariance(0.0,0.0,0.0);
 if(method==0u){
  var offset=vec2f(0.0);
  if(rs.upsample.y>0.0){
   let e=blueNoiseVec2(px,rs.size.w);
   let jitter=(e*2.0-vec2f(1.0))*f32(rs.size.z)*rs.upsample.y;
   let jittered=vec2u(clamp(vec2f(px)+jitter,vec2f(0.0),view.viewport.xy-vec2f(1.0)));
   let jz=hizOpaqueDepth(vec2i(jittered));
   if(jz>0.0){
    let distance=abs(dot(worldAt(vec2f(jittered)+vec2f(0.5),jz),m.N)-planeD);
    let relative=distance/m.depth;
    if(exp2(-1000000.0*relative*relative)>0.01){offset=jitter;}
   }
  }
  var taps=rsUniformTaps(vec2f(px),offset,m.P,m.depth,m.N);
  taps.weights/=max(dot(taps.weights,vec4f(1.0)),0.01);
  // Without one valid reservoir the unjittered place is taken.
  if(dot(taps.weights,vec4f(1.0))<=0.99){
   taps=rsUniformTaps(vec2f(px),vec2f(0.0),m.P,m.depth,m.N);
   taps.weights/=max(dot(taps.weights,vec4f(1.0)),0.01);
  }
  for(var i=0u;i<4u;i++){
   let r=rsLoad(rs.sets.x,taps.coord[i]);
   let weight=taps.weights[i];
   if(r.depth>0.0&&weight>0.0){
    let give=rsGive(r,m.N,V,m.rough);
    diffuse+=give.diffuse*weight;
    rest+=give.rest*weight;
    vary=rsVary(vary,give.light,weight);
   }
  }
  rest=rsUntonemap(rest);
 }else if(method==1u){
  let scale=rs.upsample.y*f32(rs.size.z)*(4.0/rs.upsample.z);
  let noise=blueNoiseScalar(px,rs.size.w);
  var weighted=vec3f(0.0);
  var weightedRest=vec3f(0.0);
  for(var i=0u;i<u32(rs.upsample.z);i++){
   let angle=(f32(i)+noise)*2.3999632;
   let radius=pow(f32(i),0.666)*scale;
   let offset=vec2i(floor(vec2f(cos(angle),sin(angle))*radius));
   let at=vec2u(clamp(vec2i(px/rs.size.z)+offset,vec2i(0),vec2i(rs.size.xy)-vec2i(1)));
   let r=rsLoad(rs.sets.x,at);
   if(r.depth>0.0){
    let distance=abs(dot(rsWorld(at,rs.size.w,r.depth),m.N)-planeD);
    let relative=distance/m.depth;
    let weight=exp2(-100000.0*relative*relative);
    let give=rsGive(r,m.N,V,m.rough);
    weighted+=give.diffuse*weight;
    weightedRest+=give.rest*weight;
    vary=rsVary(vary,give.light,weight);
   }
  }
  if(vary.total>0.0){
   diffuse=weighted/vary.total;
   rest=rsUntonemap(weightedRest/vary.total);
  }
 }else{
  let at=min(px/rs.size.z,rs.size.xy-vec2u(1u));
  let r=rsLoad(rs.sets.x,at);
  if(r.s.pdf>0.0){
   let give=rsGive(r,m.N,V,m.rough);
   diffuse=give.diffuse;
   rest=rsUntonemap(give.rest);
  }
 }
 var variance=0.0;
 if(rs.upsample.w!=0.0){variance=min(select(0.0,vary.s/vary.total,vary.total>0.0),${DISOCCLUSION_VARIANCE}.0-0.1);}
 // The diffuse is the irradiance over pi: the lighting multiplies it by the albedo.
 textureStore(lightOut,vec2i(px),vec4f(diffuse*0.31830989,1.0));
 textureStore(restOut,vec2i(px),vec4f(rest,variance));
}`

const ACCUMULATE_KERNEL_WGSL = `var<private> RS_AROUND=array<vec2i,8>(vec2i(-1,-1),vec2i(0,-1),vec2i(1,-1),vec2i(-1,0),vec2i(1,0),vec2i(-1,1),vec2i(0,1),vec2i(1,1));
/** The pixel's light blended with the last image's where its surface stood: the four texels round the place weighed bilinearly and by whether their own depth agrees (a disocclusion test of each), the history held in the neighbourhood of the new light, entering at one over one plus the frames held; the variance accumulates likewise. */
@compute @workgroup_size(8,8)
fn ${IMAGE_ENTRIES.accumulate}(@builtin(global_invocation_id) id:vec3u){
 let px=id.xy;
 if(any(px>=vec2u(view.viewport.xy))){return;}
 let m=rsMaterial(px);
 if(!m.valid){
  textureStore(lightOut,vec2i(px),vec4f(0.0));
  textureStore(restOut,vec2i(px),vec4f(0.0));
  textureStore(framesOut,vec2i(px),vec4f(0.0));
  return;
 }
 let size=reflectionView.radiance.xy;
 let past=rsPast(m.P,vec2f(px)+vec2f(0.5),hizOpaqueDepth(vec2i(px)));
 let onscreen=rs.image.w!=0u&&past.valid&&all(past.pixel>vec2f(0.5))&&all(past.pixel<size-vec2f(1.0));
 let at=clamp(past.pixel,vec2f(0.5),size-vec2f(1.0));
 let origin=floor(at-vec2f(0.5));
 let f=fract(at-vec2f(0.5));
 let last=vec2i(textureDimensions(historyLight))-vec2i(1);
 let previousDepth=reflectionLinearOfDevice(past.z);
 let noise=interleavedGradientNoise(vec2f(px),f32(rs.size.w%8u));
 let facing=clamp(saturate(dot(viewToEye(m.P),m.N)),0.1,1.0);
 let threshold=rs.accumulate.y*mix(0.5,1.5,noise)/facing;
 let bilinear=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
 var visibility=vec4f(0.0);
 var texel=array<vec2i,4>();
 for(var i=0u;i<4u;i++){
  texel[i]=clamp(vec2i(origin)+vec2i(i32(i&1u),i32(i>>1u)),vec2i(0),last);
  let depth=textureLoad(historyFrames,texel[i],0).g;
  let occluded=select(0.0,1.0,abs(depth-previousDepth)>=previousDepth*threshold);
  visibility[i]=saturate(select(0.0,1.0,onscreen)-occluded);
 }
 let weights=bilinear*visibility;
 let inverse=1.0/max(dot(weights,vec4f(1.0)),0.00001);
 var kept=vec3f(0.0);
 var keptRest=vec3f(0.0);
 var frames=0.0;
 var historyVariance=0.0;
 let maxFrames=rs.accumulate.x;
 for(var i=0u;i<4u;i++){
  kept+=textureLoad(historyLight,texel[i],0).rgb*weights[i];
  keptRest+=textureLoad(historyRest,texel[i],0).rgb*weights[i];
  frames+=min(textureLoad(historyFrames,texel[i],0).r*maxFrames+1.0,maxFrames)*weights[i];
  historyVariance+=textureLoad(historyRest,texel[i],0).a*bilinear[i];
 }
 kept*=inverse*rs.exposure.y;
 keptRest*=inverse*rs.exposure.y;
 let newFrames=select(0.0,min(frames*inverse,maxFrames),onscreen);
 let light=textureLoad(lightIn,vec2i(px),0).rgb;
 let rest=textureLoad(restIn,vec2i(px),0).rgb;
 // The history is held to the range of the new light's 3x3 neighbourhood.
 var lightMin=light;var lightMax=light;var restMin=rest;var restMax=rest;
 let high=vec2i(view.viewport.xy)-vec2i(1);
 for(var i=0u;i<8u;i++){
  let n=clamp(vec2i(px)+RS_AROUND[i],vec2i(0),high);
  let l=textureLoad(lightIn,n,0).rgb;
  let r=textureLoad(restIn,n,0).rgb;
  lightMin=min(lightMin,l);lightMax=max(lightMax,l);restMin=min(restMin,r);restMax=max(restMax,r);
 }
 kept=clamp(kept,lightMin,lightMax);
 keptRest=clamp(keptRest,restMin,restMax);
 let alpha=1.0/(1.0+newFrames);
 let outLight=max(mix(kept,light,alpha),vec3f(0.0));
 let outRest=max(mix(keptRest,rest,alpha),vec3f(0.0));
 var variance=0.0;
 if(rs.upsample.w!=0.0){
  var historyWeight=select(0.0,0.9,onscreen);
  var fresh=textureLoad(restIn,vec2i(px),0).a;
  if(dot(visibility,vec4f(1.0))<1.0){historyWeight=0.0;fresh=${DISOCCLUSION_VARIANCE}.0;}
  variance=max(mix(fresh,select(0.0,historyVariance,historyWeight>0.0),historyWeight),0.0);
 }
 textureStore(lightOut,vec2i(px),vec4f(outLight,1.0));
 textureStore(restOut,vec2i(px),vec4f(outRest,variance));
 textureStore(framesOut,vec2i(px),vec4f(newFrames/maxFrames,m.depth,0.0,0.0));
}`

const BILATERAL_KERNEL_WGSL = `/** The last blur: a pixel whose variance is high enough is averaged with samples of a disc round it (a Hammersley set turned per pixel and frame), each weighed by its distance, its closeness to the pixel's plane and the angle of its normal (not at a disocclusion), in tonemapped light. */
@compute @workgroup_size(8,8)
fn ${IMAGE_ENTRIES.bilateral}(@builtin(global_invocation_id) id:vec3u){
 let px=id.xy;
 if(any(px>=vec2u(view.viewport.xy))){return;}
 let m=rsMaterial(px);
 var outLight=vec3f(0.0);
 var outRest=vec3f(0.0);
 if(m.valid){
  outLight=rsTonemap(textureLoad(lightIn,vec2i(px),0).rgb);
  outRest=rsTonemap(textureLoad(restIn,vec2i(px),0).rgb);
  let variance=textureLoad(restIn,vec2i(px),0).a;
  let strong=select(0.0,1.0,variance>rs.strong.x);
  let disocclusion=select(0.0,1.0,variance>${DISOCCLUSION_VARIANCE}.0-0.1);
  let radius=rs.bilateral.x*view.viewport.x*mix(1.0,2.0,strong);
  if(radius>=0.5&&variance>0.04){
   var total=1.0;
   let gaussian=2.0/(radius*radius);
   let normalScale=1.0/(3.14159265*rs.bilateral.w);
   let seed=rand3dPcg16(vec3i(vec2i(px),i32(rs.size.w%8u))).xy;
   let planeD=dot(m.P,m.N);
   let count=min(u32(rs.bilateral.y*mix(1.0,2.0,strong)),16u);
   for(var i=0u;i<count;i++){
    let offset=(hammersley16(i,count,seed)-vec2f(0.5))*2.0*radius;
    let neighbour=vec2i(vec2f(px)+offset);
    if(any(neighbour<vec2i(0))||any(neighbour>=vec2i(view.viewport.xy))){continue;}
    let n=rsMaterial(vec2u(neighbour));
    if(!n.valid){continue;}
    let distance=abs(dot(n.P,m.N)-planeD);
    let relative=distance/m.depth;
    let depthWeight=exp2(-rs.bilateral.z*relative*relative);
    let spatial=exp2(-gaussian*dot(offset,offset));
    let angle=acos(saturate(dot(m.N,n.N)));
    let normalWeight=1.0-saturate(angle*normalScale);
    let weight=spatial*depthWeight*mix(normalWeight,1.0,disocclusion);
    outLight+=rsTonemap(textureLoad(lightIn,neighbour,0).rgb)*weight;
    outRest+=rsTonemap(textureLoad(restIn,neighbour,0).rgb)*weight;
    total+=weight;
   }
   outLight/=total;
   outRest/=total;
  }
  outLight=rsUntonemap(outLight);
  outRest=rsUntonemap(outRest);
 }
 textureStore(lightOut,vec2i(px),vec4f(outLight,select(0.0,1.0,m.valid)));
 textureStore(restOut,vec2i(px),vec4f(outRest,0.0));
}`

/** The program of the pixel kernels: the upsampling and integration, the temporal accumulation and the bilateral filter. */
export const imageProgram = () =>
  wgslProgram([UPSAMPLE_KERNEL_WGSL, ACCUMULATE_KERNEL_WGSL, BILATERAL_KERNEL_WGSL].join('\n'), [
    RESERVOIR_WGSL,
    RESERVOIR_PAST_WGSL,
    IMAGE_TEXTURES_WGSL,
    GIVE_WGSL,
    TAPS_WGSL,
    rand3dPcg16,
  ])
