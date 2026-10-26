import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SSS_SAMPLE_WGSL } from './separableWgsl.ts'
import { SSS_TILE_TYPE as T } from './layout.ts'

/** The most samples a pixel takes, the weight the variance estimate moves by, the variance the count is chosen for and the floor of
 *  the count. */
const NUM_SAMPLES = 64
const EXPONENTIAL_WEIGHT = 0.2
const VARIANCE_LEVEL = 0.0001
const BETA_LIMIT = 8
/** The mip level's constant: how much the count of samples moves the level a sample is read from. */
const MIP_FACTOR = 0.0625

/**
 * THE QUALITY HISTORY of the sampled scattering (`sssHistory`): for each texel the result of the last image's variance estimate
 * (`x` the mean count, `y` the mean count in half resolution, `z` the variance, `w` the mean of the luminance residual), found where the
 * texel's surface was in the last image — the camera's motion with the surface's depth, or the vector of the velocity stage where the
 * surface moves by itself —, the texel nearest that position; none (zero) when the position is outside the image.
 */
const SSS_HISTORY_WGSL = wgslBlock(
  'SSS_HISTORY_WGSL',
  [SSS_SAMPLE_WGSL],
  `struct SssHistory{value:vec4f,off:bool}
fn sssHistory(uv:vec2f)->SssHistory{
 var h:SssHistory;
 let viewport=uv*view.sub.zw/view.sub.xy;
 let ndc=vec2f(viewport.x*2.0-1.0,1.0-viewport.y*2.0);
 let pixel=sssPixelAtUv(uv);
 let before=view.clip*vec4f(ndc,hizOpaqueDepth(pixel),1.0);
 var back=ndc-before.xy/before.w;
 if(view.jitter.z>0.5){
  let word=textureLoad(vectors,clamp(pixel,vec2i(0),vec2i(textureDimensions(vectors))-vec2i(1)),0).r;
  if(hasOwnMotion(word)){back=decodeVector(word);}
 }
 let there=ndc-back;
 h.off=max(abs(there.x),abs(there.y))>=1.0;
 h.value=vec4f(0.0);
 if(!h.off){
  let huv=vec2f(there.x*0.5+0.5,0.5-there.y*0.5)*view.sub.xy/view.sub.zw;
  let size=vec2i(textureDimensions(texC));
  h.value=textureLoad(texC,clamp(vec2i(floor(huv*vec2f(size))),vec2i(0),size-vec2i(1)),0);
 }
 return h;
}
fn sssSampleCount(uv:vec2f)->i32{
 let q=sssHistory(uv).value;
 var n=clamp(q.b/${VARIANCE_LEVEL},${BETA_LIMIT}.0,${NUM_SAMPLES}.0);
 if(SSS_HALF){
  let estimated=q.g*${2 / EXPONENTIAL_WEIGHT - 1};
  n=clamp(q.b*estimated/${VARIANCE_LEVEL}-estimated,8.0,${NUM_SAMPLES}.0);
 }
 return i32(n);
}`,
)

/**
 * THE SAMPLED SCATTERING (`sssSampled`), adaptive importance sampling of the profile's own distribution: each pixel takes a count of
 * samples chosen for its variance (the history's), each at a radius drawn from the distribution of its profile and an angle of a
 * low-discrepancy sequence started at a hash of the pixel and the image; the radius is turned to a pixel offset by the profile's world
 * scale and the depth, and the radiance read there from the mip of the setup texture the sample's density asks for. A sample weighs
 * by the diffusion profile over its density, by how alike its normal is to the pixel's and, as the radius grows by the depth between the
 * two, by the distance; the samples of other profiles are tinted by the boundary bleed and those of no profile weigh nothing.
 * The probability that a sample falls on the pixel itself is taken out of the draws, the pixel's own radiance weighed by it instead.
 * The tile's setup colours, normals and profiles are read once into the group's memory: a sample inside the ten by ten texels they
 * cover is read from there, at mip 0.
 */
export const SSS_SAMPLED_WGSL = wgslBlock(
  'SSS_SAMPLED_WGSL',
  [SSS_HISTORY_WGSL],
  `var<workgroup> wgColour:array<vec4f,100>;
var<workgroup> wgNormal:array<vec3f,100>;
var<workgroup> wgProfile:array<u32,100>;
struct SssSample{colour:vec4f,normal:vec3f,profile:u32}
fn sssMipsMade()->bool{return atomicLoad(&counts[${T.sampled}u])>=u32(view.scatter.w);}
fn sssClampLevel(uv:vec2f,mip:f32)->vec2f{
 let m=f32((1u<<(1u+u32(ceil(mip))))-2u)/view.sub.zw;
 let high=select(m,vec2f(0.0),view.sub.xy==view.sub.zw);
 return clamp(uv,sssBilinearMin(),sssBilinearMax()-high);
}
fn sssFetch(centre:vec2f,offset:vec2f,local:vec2u,mipLevel:f32)->SssSample{
 var mip=mipLevel;
 if(!sssMipsMade()){mip=0.0;}
 let clamped=sssClampLevel(centre+offset,mip);
 var s:SssSample;
 let g=offset*view.sub.zw+vec2f(local);
 if(mip==0.0&&all(g>=vec2f(-1.0))&&all(g<vec2f(9.0))){
  let id=vec2i(g+vec2f(1.0));
  let at=id.x+id.y*10;
  s.colour=wgColour[at];
  s.normal=wgNormal[at];
  s.profile=wgProfile[at];
  return s;
 }
 let level=i32(mip);
 let size=vec2i(textureDimensions(texA,level));
 s.colour=textureLoad(texA,clamp(vec2i(floor(clamped*vec2f(size))),vec2i(0),size-vec2i(1)),level);
 let pixel=sssPixelAtUv(clamped);
 s.normal=vec3f(1.0,0.0,0.0);
 if(SSS_BILATERAL){s.normal=sssNormalAt(pixel);}
 if(SSS_CACHE){s.profile=sssCachedProfile(clamped,s.colour.w);}
 else{s.profile=select(SSS_INVALID,sssProfileAt(pixel),sssIsProfile(pixel));}
 return s;
}
fn sssSampled(uv:vec2f,local:vec2u)->vec4f{
 let centre=sssFetch(uv,vec2f(0.0),local,0.0);
 let depth=centre.colour.w;
 let original=centre.colour.rgb;
 if(depth<=0.0){return vec4f(0.0);}
 let pixel=sssPixelAtUv(uv);
 let normal=sssNormalAt(pixel);
 let profile=sssProfileAt(pixel);
 let b=sssBurley(profile,sssOpacityAt(pixel));
 let dmfp=b.dmfp.a;
 let s=sssScaleOf(b.albedo.a);
 let s3=sssScale3(b.albedo.rgb);
 let bleed=sssBleed(profile);
 var seed=i32(view.words.x);
 var count=sssSampleCount(uv);
 let forced=i32(view.scatter.z);
 if(forced>0){count=forced;}
 let inv=1.0/f32(count);
 var seed3=vec3i(vec2i(floor(uv*view.sub.zw)),0);
 seed=i32(rand3dPcg16(vec3i(seed3.xy,seed)).x);
 let scale=sssBurleyScale(b.unit,depth);
 let radiusC=sssCenterRadius(scale);
 let cdfC=sssCdf(dmfp/s,radiusC);
 let weightC=sssCenterWeight(depth,b);
 var accum=vec3f(0.0);
 var weights=vec3f(0.0);
 var bleeds=vec3f(0.0);
 for(var i=0;i<count;i++){
  seed3.z=seed;
  seed=seed+1;
  let phi=1.324717957244746;
  var random=fract(vec2f(1.0/phi,1.0/(phi*phi))*f32(u32(seed3.z)));
  random.x=cdfC+random.x*(1.0-cdfC);
  let radius=max(sssRadiusOf(dmfp/s,random.x),0.00001);
  let theta=random.y*6.283185307179586;
  let pdf=sssPdf(radius,dmfp,s);
  var offset=scale*radius;
  offset.x*=cos(theta);
  offset.y*=sin(theta);
  let size=scale.x*scale.y;
  var mip=0.5*max(-log2(${MIP_FACTOR}*f32(count)*pdf/(dmfp*dmfp*size)),0.0);
  if(SSS_HALF){mip-=1.0;}
  mip=clamp(ceil(mip),0.0,5.0);
  let found=sssFetch(uv,offset,local,mip);
  let normalWeight=sqrt(saturate(dot(found.normal,normal)*0.5+0.5));
  let deltaDepth=(found.colour.w-depth)*CM_TO_MM/b.unit;
  let radiusSampled=sqrt(radius*radius+deltaDepth*deltaDepth);
  bleeds+=select(bleed,vec3f(1.0),found.profile==profile||found.profile==SSS_INVALID);
  let mask=select(0.0,1.0,found.profile!=SSS_INVALID);
  let w=(sssProfileDensity(b.dmfp.xyz,s3,radiusSampled)/pdf)*mask*normalWeight;
  accum+=w*found.colour.rgb;
  weights+=w;
 }
 var radiance=accum*select(vec3f(1.0)/weights/0.99995,vec3f(0.0),weights==vec3f(0.0));
 radiance*=bleeds*inv;
 radiance=mix(radiance,original,weightC);
 let keep=saturate((b.opacity-SSS_OPACITY_EPS)/SSS_OPACITY_EPS);
 return vec4f(mix(original,radiance,keep),f32(count));
}
fn sssFill(tile:vec2u,gi:u32){
 for(var i=0u;i<2u;i++){
  let at=gi*2u+i;
  if(at<100u){
   let origin=vec2f(tile*8u)-vec2f(1.0);
   let raw=(origin+vec2f(f32(at%10u),f32(at/10u))+vec2f(0.5))/view.sub.zw;
   let uv=clamp(raw,sssBilinearMin(),sssBilinearMax());
   wgColour[at]=textureLoad(texA,vec2i(floor(uv*view.sub.zw)),0);
   let pixel=sssPixelAtUv(uv);
   wgNormal[at]=select(vec3f(0.0),sssNormalAt(pixel),SSS_BILATERAL);
   wgProfile[at]=select(SSS_INVALID,sssProfileAt(pixel),sssIsProfile(pixel));
  }
 }
}
@compute @workgroup_size(64)
fn sssSampledScatter(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){
 let index=sssTileIndex(g);
 let valid=index<sssCount(${T.sampled}u);
 var tile=vec2u(0u);
 if(valid){tile=sssTileAt(${T.sampled}u,index);}
 sssFill(tile,gi);
 workgroupBarrier();
 if(valid){
  let local=vec2u(gi%8u,gi/8u);
  let pos=tile*8u+local;
  let uv=(vec2f(pos)+vec2f(0.5))/view.sub.zw;
  textureStore(outA,pos,sssSampled(uv,local));
 }
}

/** The variance update (\`sssVariance\`), run after the first pass: for each pixel of the sampled scattering, the history' update from the
 *  luminance residual of the scattered colour against the setup's, read where the projection's jitter was, in a gamma space. The
 *  scattered colour is passed on with an alpha of one; a pixel of the separable scattering is left alone. */
fn sssUpdate(colour:vec4f,uv:vec2f)->vec4f{
 var w=${EXPONENTIAL_WEIGHT};
 let h=sssHistory(uv);
 if(h.off){w=1.0;}
 let history=h.value;
 let bilinear=colour;
 let jitter=vec2f(view.jitter.x*0.5,-view.jitter.y*0.5)*view.sub.xy/view.sub.zw;
 let removed=clamp(uv-jitter,sssBilinearMin(),sssBilinearMax());
 let control=textureSampleLevel(texB,linearSampler,removed,0.0);
 let gamma=1.0/2.2;
 let residual=luminance(pow(max(bilinear.rgb,vec3f(0.0)),vec3f(gamma)))-luminance(pow(max(control.rgb,vec3f(0.0)),vec3f(gamma)));
 var next=vec4f(0.0);
 next.a=(1.0-w)*history.a+w*residual;
 let delta=residual-history.a;
 next.b=(1.0-w)*history.b+w*(1.0-w)*delta*delta;
 if(SSS_HALF){next.g=(1.0-w)*history.g+w*colour.a;}
 else{next.g=history.b*colour.a;}
 next.r=(1.0-w)*history.r+w*colour.a/${NUM_SAMPLES}.0;
 if(colour.a<=0.0){next=vec4f(0.0);}
 return next;
}
@compute @workgroup_size(64)
fn sssVariance(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){
 let index=sssTileIndex(g);
 if(index>=sssCount(${T.sampled}u)){return;}
 let tile=sssTileAt(${T.sampled}u,index);
 let pos=tile*8u+vec2u(gi%8u,gi/8u);
 let uv=(vec2f(pos)+vec2f(0.5))/view.sub.zw;
 let colour=textureLoad(texA,vec2i(pos),0);
 if(sssUseBurley(sssGbufferProfile(uv))){
  textureStore(outHistory,pos,sssUpdate(colour,uv));
  textureStore(outA,pos,vec4f(colour.rgb,1.0));
 }
}`,
)
