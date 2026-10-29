import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { DN_PARAMS_WGSL } from './denoiseMotionWgsl.ts'
import { DN_FLAG_SINGLE_CHANNEL } from './denoisePrepassWgsl.ts'

export const DN_SPATIAL_ENTRY = 'dnSpatial'
/** The bit of `DnParams.flags` that says a variance image is bound (else the luminance of the neighbours is not compared). */
export const DN_FLAG_HAS_VARIANCE = 16
/** The passes of the spatial filter: the step doubles at each, 1, 2, 4, 8. */
export const DN_SPATIAL_PASSES = 4

/**
 * THE SPATIAL STAGE (`dnSpatial`, one pass of an edge-avoiding wavelet filter, run `DN_SPATIAL_PASSES` times with the step `1 << iteration`): the radiance of a pixel is the mean of the 5 by 5 taps
 * a step apart, weighed by the B3 spline and by what the guides say of the neighbour: its normal against the pixel's (to the 64th power of the cosine; a pixel with none, the sky, joins only the ones
 * with none), its albedo, and its luminance against the pixel's in units of the pixel's own noise (the variance image's standard error, four of them: a neighbour further off is a different surface, not noise).
 * With no variance image the luminance is not compared. The alpha is filtered with the rest.
 */
export const DN_SPATIAL_WGSL = wgslProgram(
  `@group(0) @binding(1) var dnRadianceIn:texture_2d<f32>;
@group(0) @binding(2) var dnAlbedoIn:texture_2d<f32>;
@group(0) @binding(3) var dnNormalIn:texture_2d<f32>;
@group(0) @binding(4) var dnVarianceIn:texture_2d<f32>;
@group(0) @binding(5) var dnSpatialOut:texture_storage_2d<rgba32float,write>;
fn dnUnit(n:vec3f)->vec3f{
 let l=length(n);
 return select(vec3f(0.0),n/max(l,1e-6),l>1e-6);
}
fn dnNoise(at:vec2i)->f32{
 let v=textureLoad(dnVarianceIn,at,0);
 return select(luminance(v.rgb),v.x,(dn.flags&${DN_FLAG_SINGLE_CHANNEL}u)!=0u);
}
@compute @workgroup_size(8,8,1)
fn ${DN_SPATIAL_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dn.size)){return;}
 let at=vec2i(id.xy);
 let last=vec2i(dn.size)-vec2i(1);
 let step=i32(1u<<dn.iteration);
 let centre=textureLoad(dnRadianceIn,at,0);
 let centreLum=luminance(centre.rgb);
 let centreNormal=dnUnit(textureLoad(dnNormalIn,at,0).xyz);
 let centreAlbedo=textureLoad(dnAlbedoIn,at,0).rgb;
 let hasVariance=(dn.flags&${DN_FLAG_HAS_VARIANCE}u)!=0u;
 let noise=select(1.0,dnNoise(at),hasVariance);
 var taps=array<f32,5>(0.0625,0.25,0.375,0.25,0.0625);
 var sum=vec4f(0.0);
 var total=0.0;
 for(var y=-2;y<=2;y++){
  for(var x=-2;x<=2;x++){
   let q=at+vec2i(x,y)*step;
   if(any(q<vec2i(0))||any(q>last)){continue;}
   let radiance=textureLoad(dnRadianceIn,q,0);
   let n=dnUnit(textureLoad(dnNormalIn,q,0).xyz);
   var weight=taps[x+2]*taps[y+2];
   let sameSky=length(n)==0.0&&length(centreNormal)==0.0;
   weight*=select(pow(max(dot(n,centreNormal),0.0),64.0),1.0,sameSky);
   let da=textureLoad(dnAlbedoIn,q,0).rgb-centreAlbedo;
   weight*=exp(-dot(da,da)/0.02);
   if(hasVariance){
    weight*=exp(-abs(luminance(radiance.rgb)-centreLum)/(4.0*noise+1e-4));
   }
   sum+=radiance*weight;
   total+=weight;
  }
 }
 textureStore(dnSpatialOut,at,select(centre,sum/total,total>0.0));
}`,
  [DN_PARAMS_WGSL, luminance],
)
