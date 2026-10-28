/**
 * THE TEMPORAL FILTER OF THE RESOLVED LIGHT: each pixel's diffuse and specular light (`shadingWgsl.ts`) blended with the history of the image before, in one pass.
 * - the neighbourhood: the 5 by 5 pixels about it but the four corners, in YCoCg (the sum, the mean, the deviation of the others against the pixel itself), the history
 *   clamped to the mean plus or minus the deviation times `sampledLightsTemporalClampScale` (and the pixel itself), more permissively where the shading confidence is
 *   high; the further the history lies from the box, the less it is trusted (`confidence`);
 * - the history: where the surface stood in the image before (the camera's motion, or the surface's own vector), its four neighbours kept where they were lit at a depth within
 *   `sampledLightsTemporalHistoryDistance` of the reprojected one (more at grazing angles) and were of the same kind as the pixel (a hair pixel's history is a hair
 *   pixel's: the reference tests no normal on these taps, only the depth and the hair); the 4 by 4 texels about it but the corners all kept, it is read by Catmull-Rom
 *   in five bilinear taps, else by the bilinear weights of the kept ones; scaled by the change of pre-exposure;
 * - the length: the history's frames plus one, held to the longest (`sampledLightsTemporalMaxFrames`, and the least after a miss, `…MinFrames`, by the confidence) and to
 *   what the shading confidence allows; the pixel enters the blend by one over that, with the moments of its luminance;
 * - a stochastic rounding of the blend, the history being kept in a half float.
 * It writes the filtered light (the confidence in the alpha of each), the moments, and the frames with the pixel's depth, for the next image and for the spatial filter.
 * A pixel that is no lit surface keeps -1. Lengths in images, lights pre-exposed.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { pixelToNdc } from '../../../../math/src/wgsl/projection.ts'
import { YCOCG_WGSL } from '../../post/taa/ycocgWgsl.ts'
import { SURFACE_PAST_WGSL } from '../bounce/screen/vectorsWgsl.ts'
import { COLOURS_BINDING_WGSL, WORDS_BINDING_WGSL } from '../deferred/litSurfaceWgsl.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { SURFACE_COLOUR_LAYERS, SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../reflections/constantsWgsl.ts'
import {
  REFLECTION_GROUP,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../reflections/viewLayout.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'

const B = SAMPLED_BINDINGS
const SIDE = SAMPLED_GROUP + 4

export const TEMPORAL_ENTRY = 'denoiseTemporalMain'

/** The light is divided by this before it enters the filter's half floats (the reference's extra exposure). */
const TEMPORAL_EXTRA_EXPOSURE = 16

const TEMPORAL_PART_1 = `
const EXTRA:f32=${TEMPORAL_EXTRA_EXPOSURE}.0;
/** 2^-10, the mantissa of the half float the history is kept in. */
const QUANTIZATION:f32=0.0009765625;
@group(0) @binding(${B.resolvedDiffuse}) var resolvedDiffuse:texture_2d<f32>;
@group(0) @binding(${B.resolvedSpecular}) var resolvedSpecular:texture_2d<f32>;
@group(0) @binding(${B.historyDiffuse}) var historyDiffuse:texture_2d<f32>;
@group(0) @binding(${B.historySpecular}) var historySpecular:texture_2d<f32>;
@group(0) @binding(${B.historyMoments}) var historyMoments:texture_2d<f32>;
@group(0) @binding(${B.historyFrames}) var historyFrames:texture_2d<u32>;
@group(0) @binding(${B.filteredDiffuse}) var filteredDiffuse:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.filteredSpecular}) var filteredSpecular:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.filteredMoments}) var filteredMoments:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.filteredFrames}) var filteredFrames:texture_storage_2d<rg32uint,write>;
@group(0) @binding(${B.historySampler}) var historySampler:sampler;
@group(0) @binding(${B.exposureBefore}) var<storage,read> exposureBefore:array<f32>;
@group(0) @binding(${B.exposureNow}) var<storage,read_write> exposureNow:array<f32>;
@group(0) @binding(${B.vectors}) var sceneVectors:texture_2d<u32>;
const SIDE:u32=${SIDE}u;
/** The resolved light of the pixels about the group's, in YCoCg with a weight (1 where lit): the diffuse then the specular. */
var<workgroup> hood:array<vec4f,${2 * SIDE * SIDE}>;
fn linearStep(a:f32,b:f32,x:f32)->f32{return saturate((x-a)/(b-a));}
fn finite3(c:vec3f)->vec3f{return select(vec3f(0.0),c,all(abs(c)<vec3f(65504.0)));}
fn finite2(c:vec2f)->vec2f{return select(vec2f(0.0),c,all(abs(c)<vec2f(65504.0)));}
fn quantize(color:vec3f,e:f32)->vec3f{
 let error=bitcast<vec3u>(color*QUANTIZATION)&vec3u(0xFF800000u);
 return color+bitcast<vec3f>(error)*e;
}
struct Box{lo:vec3f,hi:vec3f,extent:vec3f,}
/** The box about the pixel's neighbours of kind kind (0 diffuse, 1 specular). */
fn neighbourhood(kind:u32,lx:u32,ly:u32,centre:vec3f,scale:f32)->Box{
 var weights=1.0;
 var sum=centre;
 var squares=vec3f(0.0);
 for(var oy=-2;oy<=2;oy++){
  for(var ox=-2;ox<=2;ox++){
   let skip=(ox==0&&oy==0)||(abs(ox)==2&&abs(oy)==2);
   if(!skip){
    let n=hood[kind*SIDE*SIDE+u32(i32(ly+2u)+oy)*SIDE+u32(i32(lx+2u)+ox)];
    let d=n.xyz-centre;
    sum+=n.xyz;
    squares+=d*d;
    weights+=n.w;
   }
  }
`
const TEMPORAL_PART_2 = ` }
 let mean=sum/weights;
 let toMean=mean-centre;
 let deviation=sqrt(max(squares/weights-toMean*toMean,vec3f(0.0)));
 var box:Box;
 box.lo=min(mean-scale*deviation,centre);
 box.hi=max(mean+scale*deviation,centre);
 box.extent=(box.hi-box.lo)*0.5;
 return box;
}
/** Catmull-Rom in five bilinear taps about the history position uv. */
fn catmullRom(tex:texture_2d<f32>,uv:vec2f,size:vec2f)->vec4f{
 let inv=1.0/size;
 let coord=uv*size;
 let iuv=floor(coord-0.5)+1.0;
 let f=coord-iuv;
 let f2=f*f;
 let f2x=f+f;
 let u=(1.25-f2)*f+0.5;
 let t0=(0.25*f2-0.0625)*(1.125-0.5*f2.yx);
 let w0=t0-f2x*t0;
 let w3=t0+f2x*t0;
 let cuv=(iuv-0.5)*inv;
 let uvs=u*inv;
 var sum=textureSampleLevel(tex,historySampler,cuv+vec2f(-inv.x,uvs.y),0.0)*w0.x;
 sum+=textureSampleLevel(tex,historySampler,cuv+vec2f(2.0*inv.x,uvs.y),0.0)*w3.x;
 sum+=textureSampleLevel(tex,historySampler,cuv+uvs,0.0)*(1.0-w0.x-w3.x-w0.y-w3.y);
 sum+=textureSampleLevel(tex,historySampler,cuv+vec2f(uvs.x,-inv.y),0.0)*w0.y;
 sum+=textureSampleLevel(tex,historySampler,cuv+vec2f(uvs.x,2.0*inv.y),0.0)*w3.y;
 return sum;
}
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${TEMPORAL_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u,@builtin(local_invocation_index) linear:u32){
 let size=vec2i(view.viewport.xy);
 let origin=vec2i(group.xy*${SAMPLED_GROUP}u)-vec2i(2);
 for(var k=linear;k<SIDE*SIDE;k+=${SAMPLED_GROUP * SAMPLED_GROUP}u){
  let x=k%SIDE;let y=k/SIDE;
  let c=origin+vec2i(i32(x),i32(y));
  var diffuse=vec4f(0.0);
  var specular=vec4f(0.0);
  let corner=(x==0u||x==SIDE-1u)&&(y==0u||y==SIDE-1u);
  if(!corner&&all(c>=vec2i(0))&&all(c<size)){
   let rd=textureLoad(resolvedDiffuse,c,0);
   let rs=textureLoad(resolvedSpecular,c,0);
   if(rd.a>=0.0){diffuse=vec4f(toYcocg(rd.rgb/EXTRA),1.0);}
`
const TEMPORAL_PART_3 = `   if(rs.a>=0.0){
    var ys=toYcocg(rs.rgb/EXTRA);
    // An outlier specular is held to keep the half float from overflowing.
    let safe=sqrt(65504.0);
    if(ys.x>=safe){ys*=safe/ys.x;}
    specular=vec4f(ys,1.0);
   }
  }
  hood[k]=diffuse;
  hood[SIDE*SIDE+k]=specular;
 }
 workgroupBarrier();
 let screen=group.xy*${SAMPLED_GROUP}u+lane.xy;
 if(any(screen>=vec2u(view.viewport.xy))){return;}
 let pixel=vec2i(screen);
 let lx=lane.x;let ly=lane.y;
 let centreD=hood[(ly+2u)*SIDE+lx+2u];
 let centreS=hood[SIDE*SIDE+(ly+2u)*SIDE+lx+2u];
 let deviceZ=hizOpaqueDepth(pixel);
 let isHair=pixelModelOf(textureLoad(words,pixel,${SURFACE_WORDS.flags},0).r)==${PIXEL_MODEL.hair}u;
 if(screen.x==0u&&screen.y==0u){exposureNow[0]=view.preExposure.x;}
 if(centreD.w<=0.0){
  textureStore(filteredDiffuse,pixel,vec4f(-1.0));
  textureStore(filteredSpecular,pixel,vec4f(-1.0));
  textureStore(filteredMoments,pixel,vec4f(0.0));
  textureStore(filteredFrames,pixel,vec4u(0u,bitcast<u32>(deviceZ),0u,0u));
  return;
 }
 let P=worldAt(vec2f(screen)+vec2f(0.5),deviceZ);
 let N=normalize(textureLoad(colours,pixel,${SURFACE_COLOUR_LAYERS.normal},0).xyz);
 // Where the surface stood in the image before.
 var found=false;
 var past=vec2f(0.0);
 let clipBefore=params.previous*vec4f(P,1.0);
 if(params.denoiseU.x!=0u&&clipBefore.w>0.0){
  let word=textureLoad(sceneVectors,vec2i(min(screen,textureDimensions(sceneVectors)-vec2u(1u))),0).r;
  past=surfacePast(word,pixelToNdc(vec2f(screen)+vec2f(0.5),vec2f(size)),clipBefore.xy/clipBefore.w);
  found=all(abs(past)<=vec2f(1.0));
 }
 let hc=vec2f((past.x*0.5+0.5)*f32(size.x),(0.5-past.y*0.5)*f32(size.y))-vec2f(0.5);
 let base=vec2i(floor(hc));
 let fr=hc-floor(hc);
 let reprojected=reflectionLinearOfDevice(clipBefore.z/max(clipBefore.w,1e-20));
 let threshold=reprojected*params.denoise.x/mix(0.1,1.0,saturate(dot(N,viewToEye(P))));
 var kept=array<f32,16>(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
`
const TEMPORAL_PART_4 = ` var bicubic=found;
 if(found){
  for(var j=0;j<4;j++){
   for(var i=0;i<4;i++){
    let c=base+vec2i(i-1,j-1);
    var ok=false;
    if(all(c>=vec2i(0))&&all(c<size)){
     let h=textureLoad(historyFrames,c,0);
     ok=(h.x&0x7FFFFFFFu)>0u&&((h.x>>31u)==select(0u,1u,isHair))&&abs(reflectionLinearOfDevice(bitcast<f32>(h.y))-reprojected)<threshold;
    }
    kept[j*4+i]=select(0.0,1.0,ok);
    let corner=(i==0||i==3)&&(j==0||j==3);
    if(!ok&&!corner){bicubic=false;}
   }
  }
 }
 let weights=vec4f((1.0-fr.y)*(1.0-fr.x),(1.0-fr.y)*fr.x,fr.y*(1.0-fr.x),fr.y*fr.x)*vec4f(kept[5],kept[6],kept[9],kept[10]);
 let weightSum=dot(weights,vec4f(1.0));
 let hasHistory=found&&weightSum>0.0;
 var diffuseOut=vec3f(0.0);
 var specularOut=vec3f(0.0);
 var momentsOut=vec4f(0.0);
 var frames=1.0;
 var diffuseConfidence=1.0;
 var specularConfidence=1.0;
 let current=vec3f(0.0);
 let curDiffuse=fromYcocg(centreD.xyz)*EXTRA;
 let curSpecular=fromYcocg(centreS.xyz)*EXTRA;
 let luma=vec3f(0.3,0.59,0.11);
 let dl=dot(curDiffuse,luma);
 let sl=dot(curSpecular,luma);
 let curMoments=vec4f(dl,min(dl*dl,65504.0),sl,min(sl*sl,65504.0));
 if(hasHistory){
  let texel=1.0/vec2f(textureDimensions(historyDiffuse));
  let uvCentre=(vec2f(base)+vec2f(0.5)+fr)*texel;
  var hd=vec3f(0.0);
  var hs=vec3f(0.0);
  if(bicubic){
   hd=catmullRom(historyDiffuse,uvCentre,vec2f(textureDimensions(historyDiffuse))).xyz;
   hs=catmullRom(historySpecular,uvCentre,vec2f(textureDimensions(historySpecular))).xyz;
  }else{
   for(var q=0u;q<4u;q++){
    let c=base+vec2i(i32(q&1u),i32(q>>1u));
    if(weights[q]>0.0){
     hd+=textureLoad(historyDiffuse,c,0).xyz*weights[q];
`
const TEMPORAL_PART_5 = `     hs+=textureLoad(historySpecular,c,0).xyz*weights[q];
    }
   }
   hd/=weightSum;
   hs/=weightSum;
  }
  var hm=vec4f(0.0);
  var hf=0.0;
  for(var q=0u;q<4u;q++){
   let c=base+vec2i(i32(q&1u),i32(q>>1u));
   if(weights[q]>0.0){
    hm+=textureLoad(historyMoments,c,0)*weights[q];
    hf+=f32(textureLoad(historyFrames,c,0).x&0x7FFFFFFFu)*weights[q];
   }
  }
  hm/=weightSum;
  hf=hf/weightSum/8.0;
  // The history, in this image's exposure.
  let before=exposureBefore[0];
  let correction=select(1.0,view.preExposure.x/before,before>0.0);
  hd*=correction;
  hs*=correction;
  hm=vec4f(hm.x*correction,hm.y*correction*correction,hm.z*correction,hm.w*correction*correction);
  hm.y=min(hm.y,65504.0);
  hm.w=min(hm.w,65504.0);
  let confidence=textureLoad(resolvedDiffuse,pixel,0).a;
  let maxByConfidence=select(params.denoise.z,1.0/(confidence*0.5),confidence>0.0);
  let clampScale=params.denoise.w*(1.0+3.0*linearStep(4.0,2.0,maxByConfidence));
  let boxD=neighbourhood(0u,lx,ly,centreD.xyz,clampScale);
  let boxS=neighbourhood(1u,lx,ly,centreS.xyz,clampScale);
  let floorExtent=vec3f(0.1/EXTRA);
  var yd=toYcocg(hd/EXTRA);
  var cd=clamp(yd,boxD.lo,boxD.hi);
  diffuseConfidence=saturate(1.0-length(abs(cd-yd)/max(boxD.extent,floorExtent)));
  cd=fromYcocg(mix(cd,yd,diffuseConfidence))*EXTRA;
  var ys=toYcocg(hs/EXTRA);
  var cs=clamp(ys,boxS.lo,boxS.hi);
  specularConfidence=saturate(1.0-length(abs(cs-ys)/max(boxS.extent,floorExtent)));
  cs=fromYcocg(mix(cs,ys,specularConfidence))*EXTRA;
  let maxD=min(mix(params.denoise.y,params.denoise.z,diffuseConfidence),maxByConfidence);
  let maxS=min(mix(params.denoise.y,params.denoise.z,specularConfidence),maxByConfidence);
  let numD=min(hf+1.0,maxD);
  let numS=min(hf+1.0,maxS);
  frames=mix(numD,numS,0.5);
  let aD=1.0/numD;
`
const TEMPORAL_PART_6 = `  let aS=1.0/numS;
  diffuseOut=mix(cd,curDiffuse,aD);
  specularOut=mix(cs,curSpecular,aS);
  momentsOut=vec4f(mix(hm.xy,curMoments.xy,aD),mix(hm.zw,curMoments.zw,aS));
  let e=interleavedGradientNoise(vec2f(screen),f32(params.frame&7u));
  diffuseOut=quantize(diffuseOut,e);
  specularOut=quantize(specularOut,e);
 }else{
  diffuseOut=curDiffuse;
  specularOut=curSpecular;
  momentsOut=curMoments;
 }
 diffuseOut=finite3(diffuseOut);
 specularOut=finite3(specularOut);
 momentsOut=vec4f(finite2(momentsOut.xy),finite2(momentsOut.zw));
 textureStore(filteredDiffuse,pixel,vec4f(diffuseOut,diffuseConfidence));
 textureStore(filteredSpecular,pixel,vec4f(specularOut,specularConfidence));
 textureStore(filteredMoments,pixel,momentsOut);
 textureStore(filteredFrames,pixel,vec4u(u32(frames*8.0+0.5)|select(0u,0x80000000u,isHair),bitcast<u32>(deviceZ),0u,0u));
}`

export const temporalWgsl = () =>
  wgslProgram(
    `${TEMPORAL_PART_1}${TEMPORAL_PART_2}${TEMPORAL_PART_3}${TEMPORAL_PART_4}${TEMPORAL_PART_5}${TEMPORAL_PART_6}`,
    [
      SAMPLED_PARAMS_WGSL,
      YCOCG_WGSL,
      interleavedGradientNoise,
      pixelToNdc,
      SURFACE_PAST_WGSL,
      COLOURS_BINDING_WGSL,
      WORDS_BINDING_WGSL,
      pixelModelOf,
      WORLD_AT_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      reflectionBindingsWgsl(REFLECTION_GROUP),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      REFLECTION_LINEAR_DEPTH_WGSL,
    ],
  )
