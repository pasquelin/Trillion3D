import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { roughnessToAlpha2Chain } from '../../../math/src/wgsl/lighting.ts'

/** GGX split-sum kernel moments for an order-2 radiance field.
 * With z=N.L, its normalized density is z/(1+k+(k-1)z)^2, k=roughness^4.
 * Zonal convolution multiplies bands 0/1/2 by E[1], E[z], E[(3z²-1)/2].
 * This evaluates the represented radiance, not a new ray budget or a second environment
 * representation. */
export const REFLECTION_BANDS_WGSL = wgslBlock(
  'REFLECTION_BANDS_WGSL',
  [roughnessToAlpha2Chain],
  `
fn reflectionProbeBands(rough:f32)->vec3f{
 let k:f32=max(roughnessToAlpha2Chain(rough),1e-8);
 let a:f32=1.0+k;let b:f32=k-1.0;var q:f32=-b/a;
 var moments:vec3f=vec3f(0.0);
 if(q<0.25){
  var power:f32=1.0;
  // The geometric tail after twelve terms is below 3e-7 at q=.25.
  for(var index:i32=0;index<12;index++){
   let i:f32=f32(index);moments+=vec3f(1.0/(i+2.0),1.0/(i+3.0),1.0/(i+4.0))*(i+1.0)*power;
   power*=q;
  }
 }else{
  let j0:f32=1.0/(a*(2.0*k));
  let h0:f32=log(2.0*k/a)/b;
  let h1:f32=(1.0-a*h0)/b;
  let h2:f32=(0.5-a*h1)/b;
  let j1:f32=(h0-a*j0)/b;
  let j2:f32=(h1-a*j1)/b;
  let j3:f32=(h2-a*j2)/b;
  moments=vec3f(j1,j2,j3);
 }
 return vec3f(1.0,moments.y/moments.x,0.5*(3.0*moments.z/moments.x-1.0));
}`,
)
