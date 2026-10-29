import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * WHAT THE ADAPTIVE SAMPLING READS OF THE ERROR'S MIP CHAIN (`ptVariance`, a texel a pixel: the sum of the pixel's values, the sum of their squares, their
 * count; each level a mip of it, `ptVarianceDims` the first level's size and the count of levels).
 * `ptPerceptualError` is the error of a mean `mean` known to `stdErr`, as seen through a filmic curve (the curve `(6x/(6x+1))²`, its
 * derivative times the error). `ptVarianceAt` reads the chain at `uv` of the level `mip` with the cubic B-spline of four bilinear reads, each bilinear
 * read made of four exact reads with the edge held (so that a device that cannot filter 32-bit floats reads the same value).
 * `ptSampleFactor` is the most, over the levels and the five by five pixels around, of the multiple of its samples a pixel needs to reach the threshold.
 */
export const PT_ADAPTIVE_UTILS_WGSL = wgslBlock(
  'PT_ADAPTIVE_UTILS_WGSL',
  [],
  `fn ptPerceptualError(mean:f32,stdErr:f32)->f32{
 let t=6.0*mean+1.0;
 return stdErr*72.0*mean/(t*t*t);
}
fn ptVarianceBilinear(uv:vec2f,mip:i32)->vec4f{
 let size=vec2i(textureDimensions(ptVariance,mip));
 let at=uv*vec2f(size)-0.5;
 let base=floor(at);
 let f=at-base;
 let lo=clamp(vec2i(base),vec2i(0),size-vec2i(1));
 let hi=clamp(vec2i(base)+vec2i(1),vec2i(0),size-vec2i(1));
 let a=mix(textureLoad(ptVariance,vec2i(lo.x,lo.y),mip),textureLoad(ptVariance,vec2i(hi.x,lo.y),mip),f.x);
 let b=mix(textureLoad(ptVariance,vec2i(lo.x,hi.y),mip),textureLoad(ptVariance,vec2i(hi.x,hi.y),mip),f.x);
 return mix(a,b,f.y);
}
fn ptVarianceAt(uv:vec2f,mip:i32)->vec4f{
 let size=vec2f(ptVarianceDims.xy>>vec2u(u32(mip)));
 let p=uv*size-0.5;
 let baseUv=floor(p);
 let f=p-baseUv;
 let o=1.0-f;
 let f2=f*f;
 let o2=o*o;
 let w0=(1.0/6.0)*o2*o;
 let w1=(2.0/3.0)-f2*(1.0-0.5*f);
 let w2=(2.0/3.0)-o2*(1.0-0.5*o);
 let w3=(1.0/6.0)*f2*f;
 let g0=w0+w1;
 let g1=w2+w3;
 let h0=(w1/g0+baseUv-0.5)/size;
 let h1=(w3/g1+baseUv+1.5)/size;
 let t00=ptVarianceBilinear(vec2f(h0.x,h0.y),mip);
 let t10=ptVarianceBilinear(vec2f(h1.x,h0.y),mip);
 let t01=ptVarianceBilinear(vec2f(h0.x,h1.y),mip);
 let t11=ptVarianceBilinear(vec2f(h1.x,h1.y),mip);
 return mix(mix(t11,t10,g0.y),mix(t01,t00,g0.y),g0.x);
}
fn ptSampleFactor(texel:vec2u,threshold:f32)->f32{
 var factor=0.0;
 var scale=1.0;
 for(var mip=0u;mip<ptVarianceDims.z;mip++){
  for(var dy=-2;dy<=2;dy++){
   for(var dx=-2;dx<=2;dx++){
    let coord=vec2i(texel>>vec2u(mip))+vec2i(dx,dy);
    if(all(vec2u(coord)<(ptVarianceDims.xy>>vec2u(mip)))){
     let v=textureLoad(ptVariance,coord,i32(mip));
     let variance=abs(v.y-v.x*v.x);
     let relErr=ptPerceptualError(v.x,sqrt(variance/v.z));
     let ratio=relErr/threshold;
     factor=max(factor,(1.0+ratio*ratio)/v.z*scale);
    }
   }
  }
  scale*=4.0;
 }
 return factor;
}`,
)
