/**
 * THE SHADOW MASK DENOISE (`denoisePass.ts`), a deliberate addition beyond the reference (`shadowDenoise`,
 * `contracts/shadowMapOptions.ts`): an edge-aware a-trous filter over the masks the projection wrote, run
 * after it and before the lighting reads them. Each pass is a 5x5 kernel of the binomial taps 1 4 6 4 1,
 * their step doubling from one pass to the next (1, 2, 4, 8) and widening, up to twice, with the penumbra
 * the local variance of the mask shows (`dnReach`). A tap's weight is the product of
 *   - its distance to the plane of the pixel's surface, relative to the pixel's depth (`dnPlaneError`: the
 *     plane through the pixel with its normal, met by the tap's own ray), so a tap on another surface weighs
 *     nothing, and a tap on the same slanted one weighs as a tap on a flat one;
 *   - the normals' dot, to a power (`DN_NORMAL_POWER`);
 *   - the shadow value's difference, as a Gaussian (`DN_VALUE_SHARPNESS`), which keeps the hard edges.
 * A pixel whose probe (13 samples out to two steps: `dnProbed`) is wholly 0 or wholly 1 (fully shadowed, fully lit) is written as it is: the
 * lit and shadowed regions cost a read of thirteen texels and stay sharp, and a block the adaptive ray stop left in
 * a deep penumbra, which sits within two texels of one of another value, is filtered. Only the lanes of a packed texel that vary are weighed. The sky (depth 0) is never
 * a tap, and the taps are held to the rect the pass filters (the pixels a per-light mask was written over).
 *
 * Three masks, one filter each: the suns' (`r32float`, a layer a sun), the per-light path's (`rgba8unorm`,
 * a layer a light: the square root of the share in every channel, the blue one read), and the one-pass
 * projection's packed lanes (4 bits a light, one to four words), each lane filtered alone and requantized
 * to 4 bits. The pass reads one texture and writes another (the mask and a scratch of its own, in turn: no
 * texture is read and written by one dispatch), the copy of the first pass (`dn.phase.y`) making the count even.
 */
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { ONE_PASS_MASK_WGSL } from '../projection/maskFormat.ts'

/** The side of a group of the filter's kernels. */
export const DENOISE_GROUP = 8

/** The masks the filter runs on: the suns' array, a per-light layer, and the one-pass projection's packed
 *  mask by the format its words make. */
export type DenoiseKind = 'sun' | 'light' | 'r32uint' | 'rg32uint' | 'rgba32uint'

/** The words of a packed mask's texel, by its kind. */
export const PACKED_WORDS = { r32uint: 1, rg32uint: 2, rgba32uint: 4 } as const

/** The format of the storage texture each kind is written in. */
export const DENOISE_FORMAT: Record<DenoiseKind, GPUTextureFormat> = {
  sun: 'r32float',
  light: 'rgba8unorm',
  r32uint: 'r32uint',
  rg32uint: 'rg32uint',
  rgba32uint: 'rgba32uint',
}

/** The words of the filter's uniform (`DenoiseParams`): seven vectors of four. */
export const DENOISE_PARAM_WORDS = 28

/** The bindings of the filter, in group 0. */
export const DENOISE_BINDING = { params: 0, depth: 1, normals: 2, source: 3, result: 4 } as const

/**
 * What every kind of the filter shares: its uniform, the depth and the normals, and the geometry
 * weights. The uniform: `rect` the pixels filtered (first column and row, one past the last), `depthMap`
 * the view depth of a depth value (`clip.z = a z + b`, `clip.w = c z + e`, as (a, b, c, e)), `scale` the
 * projection's x and y scales and the target's two pixel sizes in clip units, `row0..2` the rotation of
 * world to view, `phase` the pass's step in pixels and whether it only copies.
 */
export const DENOISE_GEOMETRY_WGSL = wgslBlock(
  'DENOISE_GEOMETRY_WGSL',
  [],
  /* wgsl */ `
struct DenoiseParams{
 rect:vec4i,
 depthMap:vec4f,
 scale:vec4f,
 row0:vec4f,
 row1:vec4f,
 row2:vec4f,
 phase:vec4f,
};
@group(0) @binding(${DENOISE_BINDING.params}) var<uniform> dn:DenoiseParams;
@group(0) @binding(${DENOISE_BINDING.depth}) var dnDepth:texture_depth_2d;
@group(0) @binding(${DENOISE_BINDING.normals}) var dnNormals:texture_2d<f32>;
const DN_DEPTH_SHARPNESS:f32=150.0;
const DN_NORMAL_POWER:f32=16.0;
const DN_VALUE_SHARPNESS:f32=2.0;
const DN_PENUMBRA_GAIN:f32=4.0;
fn dnClampTo(p:vec2i)->vec2i{return clamp(p,dn.rect.xy,dn.rect.zw-vec2i(1));}
fn dnNdc(p:vec2i)->vec2f{return vec2f((f32(p.x)+0.5)*dn.scale.z-1.0,1.0-(f32(p.y)+0.5)*dn.scale.w);}
fn dnViewZ(d:f32)->f32{return (dn.depthMap.w*d-dn.depthMap.y)/(dn.depthMap.x-dn.depthMap.z*d);}
fn dnNormalView(p:vec2i)->vec3f{
 let n=textureLoad(dnNormals,p,0).xyz;
 return vec3f(dot(dn.row0.xyz,n),dot(dn.row1.xyz,n),dot(dn.row2.xyz,n));
}
/** The binomial tap of offset o: 1 4 6 4 1. */
fn dnTapWeight(o:i32)->f32{
 let a=abs(o);
 return select(select(1.0,4.0,a==1),6.0,a==0);
}
/** Whether the offset (i, j) of the pass's probe is one of its 13 samples: the axes out to two steps and the four corners at two steps. The probe tells the uniform regions from the penumbra (and its spread sizes the reach): a block of the adaptive ray stop, a few texels wide, is met by it as the taps would meet it. */
fn dnProbed(i:i32,j:i32)->bool{return i==0||j==0||(abs(i)==2&&abs(j)==2);}
fn dnProbeAt(p:vec2i,i:i32,j:i32)->vec2i{return dnClampTo(p+vec2i(i,j)*i32(dn.phase.x));}
/** The offset of tap o at the pass's reach, in whole pixels: the inner taps stand one step away (the grain of a texel is always met), the outer ones at the reach, which the penumbra widens. */
fn dnTapOffset(o:i32,reach:f32)->i32{
 let outer=select(-1,1,o>0)*i32(round(2.0*reach));
 return select(o*i32(dn.phase.x),outer,abs(o)==2);
}
/** The reach of a pass at a pixel: its step, up to twice as wide where the 3x3 neighbourhood's values spread (the penumbra's size, from the variance). */
fn dnReach(sd:f32)->f32{return dn.phase.x*(1.0+clamp(sd*DN_PENUMBRA_GAIN,0.0,1.0));}
/** The offset of the plane through the pixel p (its depth z, normal n, view space) from the view origin along n. */
fn dnPlaneOffset(z:f32,n:vec3f,p:vec2i)->f32{
 let ndc=dnNdc(p);
 let w=dn.depthMap.z*z+dn.depthMap.w;
 return dot(n,vec3f(ndc.x*w/dn.scale.x,ndc.y*w/dn.scale.y,z));
}
/** The distance, relative to the pixel's depth z, of the surface at the tap q (its view depth zq) to the pixel's plane (offset d, normal n) along q's ray. */
fn dnPlaneError(d:f32,z:f32,n:vec3f,q:vec2i,zq:f32)->f32{
 let ndc=dnNdc(q);
 let k=n.x*ndc.x/dn.scale.x+n.y*ndc.y/dn.scale.y;
 let den=dn.depthMap.z*k+n.z;
 let safe=select(den,select(-1e-6,1e-6,den>=0.0),abs(den)<1e-6);
 let expected=(d-dn.depthMap.w*k)/safe;
 return abs(zq-expected)/max(abs(z),1e-6);
}
/** The geometry's weight of the tap q for the pixel (depth z, view normal n, plane offset d): 0 on the sky and on another surface, 1 on its own plane. */
fn dnGeometryWeight(d:f32,z:f32,n:vec3f,q:vec2i)->f32{
 let depth=textureLoad(dnDepth,q,0);
 if(depth<=0.0){return 0.0;}
 let error=dnPlaneError(d,z,n,q,dnViewZ(depth));
 let facing=pow(max(dot(n,dnNormalView(q)),0.0),DN_NORMAL_POWER);
 return exp(-error*DN_DEPTH_SHARPNESS)*facing;
}
/** The value's weight of a tap whose value differs by dv from the pixel's. */
fn dnValueWeight(dv:f32)->f32{return exp(-DN_VALUE_SHARPNESS*dv*dv);}
/** The pixels this thread filters, and whether it lies in the rect. */
fn dnPixel(gid:vec3u)->vec2i{return dn.rect.xy+vec2i(gid.xy);}
fn dnInRect(p:vec2i)->bool{return all(p<dn.rect.zw);}
`,
)

/** A scalar mask's kernel: the suns' array or a per-light layer. The value is `valueOf`, the channel the lighting reads. */
const scalarKernel = (array: boolean, format: GPUTextureFormat, valueOf: string) => /* wgsl */ `
@group(0) @binding(${DENOISE_BINDING.source}) var dnSrc:${array ? 'texture_2d_array<f32>' : 'texture_2d<f32>'};
@group(0) @binding(${DENOISE_BINDING.result}) var dnDst:${array ? 'texture_storage_2d_array' : 'texture_storage_2d'}<${format},write>;
fn dnLoad(p:vec2i,layer:i32)->vec4f{return ${array ? 'textureLoad(dnSrc,p,layer,0)' : 'textureLoad(dnSrc,p,0)'};}
fn dnStore(p:vec2i,layer:i32,v:vec4f){${array ? 'textureStore(dnDst,p,layer,v);' : 'textureStore(dnDst,p,v);'}}
fn dnValue(v:vec4f)->f32{return v.${valueOf};}
/** The pixel p of the layer, filtered: itself where its probe (dnProbed) finds 0 everywhere or 1 everywhere. */
fn dnSmooth(p:vec2i,layer:i32)->vec4f{
 let c=dnLoad(p,layer);
 if(dn.phase.y>0.5){return c;}
 let cv=dnValue(c);
 var lo=cv;var hi=cv;var sum=0.0;var sum2=0.0;
 for(var j=-2;j<=2;j++){
  for(var i=-2;i<=2;i++){
   if(dnProbed(i,j)){
    let v=dnValue(dnLoad(dnProbeAt(p,i,j),layer));
    lo=min(lo,v);hi=max(hi,v);sum+=v;sum2+=v*v;
   }
  }
 }
 if(hi<=0.0||lo>=1.0){return c;}
 let depth=textureLoad(dnDepth,p,0);
 if(depth<=0.0){return c;}
 let z=dnViewZ(depth);
 let n=dnNormalView(p);
 let d=dnPlaneOffset(z,n,p);
 let mean=sum/13.0;
 let reach=dnReach(sqrt(max(sum2/13.0-mean*mean,0.0)));
 var acc=vec4f(0.0);var total=0.0;
 for(var j=-2;j<=2;j++){
  for(var i=-2;i<=2;i++){
   var w=dnTapWeight(i)*dnTapWeight(j);
   var v=c;
   if(i!=0||j!=0){
    let q=dnClampTo(p+vec2i(dnTapOffset(i,reach),dnTapOffset(j,reach)));
    v=dnLoad(q,layer);
    w=w*dnGeometryWeight(d,z,n,q)*dnValueWeight(dnValue(v)-cv);
   }
   acc+=v*w;total+=w;
  }
 }
 return acc/total;
}
@compute @workgroup_size(${DENOISE_GROUP},${DENOISE_GROUP},1)
fn vsmDenoise(@builtin(global_invocation_id) gid:vec3u){
 let p=dnPixel(gid);
 if(!dnInRect(p)){return;}
 let layer=i32(gid.z);
 dnStore(p,layer,dnSmooth(p,layer));
}
`

/** An array of `n` zeros, written out. */
const zeros = (n: number) => `array<f32,${n}>(${Array<string>(n).fill('0.0').join(',')})`

/** The packed mask's kernel, over `words` words a texel. Each lane (a light's 4 bits) is smoothed alone, the geometry weights shared; a lane uniformly 0 or 15 over the 3x3 stays as it is. */
const packedKernel = (format: GPUTextureFormat, words: number) => /* wgsl */ `
const DN_WORDS:u32=${words}u;
const DN_LANES:u32=${words * 8}u;
@group(0) @binding(${DENOISE_BINDING.source}) var dnSrc:texture_2d<u32>;
@group(0) @binding(${DENOISE_BINDING.result}) var dnDst:texture_storage_2d<${format},write>;
fn dnWords(p:vec2i)->vec4u{return textureLoad(dnSrc,p,0);}
fn dnShare(word:u32,lane:u32)->f32{return f32((word>>(lane*ONE_PASS_MASK_BITS))&ONE_PASS_MASK_MAX)/f32(ONE_PASS_MASK_MAX);}
fn dnQuantize(v:f32)->u32{return u32(round(clamp(v,0.0,1.0)*f32(ONE_PASS_MASK_MAX)));}
/** Whether a lane of the word is neither 0 in all nine texels (orWord) nor 15 in all (andWord). */
fn dnLaneVaries(andWord:u32,orWord:u32,lane:u32)->bool{
 let o=(orWord>>(lane*ONE_PASS_MASK_BITS))&ONE_PASS_MASK_MAX;
 let a=(andWord>>(lane*ONE_PASS_MASK_BITS))&ONE_PASS_MASK_MAX;
 return o!=0u&&a!=ONE_PASS_MASK_MAX;
}
fn dnSmoothPacked(p:vec2i)->vec4u{
 let c=dnWords(p);
 if(dn.phase.y>0.5){return c;}
 var allOf=c;var anyOf=c;
 for(var j=-2;j<=2;j++){
  for(var i=-2;i<=2;i++){
   if(dnProbed(i,j)){
    let w=dnWords(dnProbeAt(p,i,j));
    allOf=allOf&w;anyOf=anyOf|w;
   }
  }
 }
 var varies=false;
 for(var k=0u;k<DN_WORDS;k++){
  for(var l=0u;l<ONE_PASS_MASK_LANES;l++){varies=varies||dnLaneVaries(allOf[k],anyOf[k],l);}
 }
 if(!varies){return c;}
 let depth=textureLoad(dnDepth,p,0);
 if(depth<=0.0){return c;}
 let z=dnViewZ(depth);
 let n=dnNormalView(p);
 let d=dnPlaneOffset(z,n,p);
 var sum=${zeros(words * 8)};var sum2=${zeros(words * 8)};
 for(var j=-2;j<=2;j++){
  for(var i=-2;i<=2;i++){
   if(dnProbed(i,j)){
    let w=dnWords(dnProbeAt(p,i,j));
    for(var k=0u;k<DN_WORDS;k++){
     for(var l=0u;l<ONE_PASS_MASK_LANES;l++){
      if(dnLaneVaries(allOf[k],anyOf[k],l)){
       let v=dnShare(w[k],l);
       sum[k*ONE_PASS_MASK_LANES+l]+=v;sum2[k*ONE_PASS_MASK_LANES+l]+=v*v;
      }
     }
    }
   }
  }
 }
 var spread=0.0;
 for(var m=0u;m<DN_LANES;m++){
  let mean=sum[m]/13.0;
  spread=max(spread,sqrt(max(sum2[m]/13.0-mean*mean,0.0)));
 }
 let reach=dnReach(spread);
 var acc=${zeros(words * 8)};var total=${zeros(words * 8)};
 for(var j=-2;j<=2;j++){
  for(var i=-2;i<=2;i++){
   let tap=dnTapWeight(i)*dnTapWeight(j);
   var geometry=1.0;
   var w=c;
   if(i!=0||j!=0){
    let q=dnClampTo(p+vec2i(dnTapOffset(i,reach),dnTapOffset(j,reach)));
    geometry=dnGeometryWeight(d,z,n,q);
    w=dnWords(q);
   }
   for(var k=0u;k<DN_WORDS;k++){
    for(var l=0u;l<ONE_PASS_MASK_LANES;l++){
     if(dnLaneVaries(allOf[k],anyOf[k],l)){
      let v=dnShare(w[k],l);
      let weight=tap*geometry*select(dnValueWeight(v-dnShare(c[k],l)),1.0,i==0&&j==0);
      acc[k*ONE_PASS_MASK_LANES+l]+=v*weight;total[k*ONE_PASS_MASK_LANES+l]+=weight;
     }
    }
   }
  }
 }
 var r=c;
 for(var k=0u;k<DN_WORDS;k++){
  var word=0u;
  for(var l=0u;l<ONE_PASS_MASK_LANES;l++){
   let m=k*ONE_PASS_MASK_LANES+l;
   let q=select(f32(dnQuantize(dnShare(c[k],l))),f32(dnQuantize(acc[m]/total[m])),dnLaneVaries(allOf[k],anyOf[k],l));
   word=word|(u32(q)<<(l*ONE_PASS_MASK_BITS));
  }
  r[k]=word;
 }
 return r;
}
@compute @workgroup_size(${DENOISE_GROUP},${DENOISE_GROUP},1)
fn vsmDenoise(@builtin(global_invocation_id) gid:vec3u){
 let p=dnPixel(gid);
 if(!dnInRect(p)){return;}
 textureStore(dnDst,p,dnSmoothPacked(p));
}
`

/** The filter's program for the mask `kind`. */
export function vsmDenoiseWgsl(kind: DenoiseKind) {
  const own =
    kind === 'sun'
      ? scalarKernel(true, DENOISE_FORMAT.sun, 'r')
      : kind === 'light'
        ? scalarKernel(false, DENOISE_FORMAT.light, 'b')
        : packedKernel(DENOISE_FORMAT[kind], PACKED_WORDS[kind])
  return wgslProgram(own, [
    DENOISE_GEOMETRY_WGSL,
    ...(kind === 'sun' || kind === 'light' ? [] : [ONE_PASS_MASK_WGSL]),
  ])
}
