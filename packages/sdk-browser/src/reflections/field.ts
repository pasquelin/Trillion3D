import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { lobeRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { probeFieldWgsl } from '../bounce/gridWgsl.ts'
import { REFLECTION_VIEW_WGSL } from './viewLayout.ts'

/**
 * The round GGX lobe of width `alpha`, its zonal moments for an order-2 radiance field: with z =
 * N·L, its normalized density is z/(1 + k + (k − 1)z)², k = α²; the zonal convolution multiplies
 * bands 1 and 2 by a₁ = E[z] and a₂ = E[(3z² − 1)/2] (band 0 whole) — a geometric series below
 * q = ¼ (its tail after twelve terms under 3e-7), the closed form above.
 */
const REFLECTION_BANDS_WGSL = wgslBlock(
  'REFLECTION_BANDS_WGSL',
  [],
  `fn reflectionBands(alpha:f32)->vec2f{
 let k=max(alpha*alpha,1e-8);
 let a=1.0+k;let b=k-1.0;let q=-b/a;
 var moments=vec3f(0.0);
 if(q<0.25){
  var power=1.0;
  for(var index=0;index<12;index++){
   let i=f32(index);moments+=vec3f(1.0/(i+2.0),1.0/(i+3.0),1.0/(i+4.0))*(i+1.0)*power;
   power*=q;
  }
 }else{
  let j0=1.0/(a*(2.0*k));
  let h0=log(2.0*k/a)/b;
  let h1=(1.0-a*h0)/b;
  let h2=(0.5-a*h1)/b;
  let j1=(h0-a*j0)/b;
  let j2=(h1-a*j1)/b;
  let j3=(h2-a*j2)/b;
  moments=vec3f(j1,j2,j3);
 }
 return vec2f(moments.y/moments.x,0.5*(3.0*moments.z/moments.x-1.0));
}`,
)

/**
 * The reflected lobe (`reflectionLobeOf`): one ellipse of directions around its centre `R` for both
 * answers — the screen footprint's two axes (`footprint.ts`) and the filter of the radiance field.
 * Its long axis `T` is the material's direction `lobe.xyz` across `R`, unit, zero on a round lobe;
 * its widths (`widths`) α = rough² across and the material's αt along `T`. Each axis keeps the
 * moments of the round GGX lobe of its width (`reflectionBands`: band attenuations a₁, a₂) — its
 * share of the mean cosine's deficit, (1 − a₁)/2, and its variance, σ² = (1 − a₂)/3 —, so with s
 * the short axis and t the long one `bands` is: band 1 × (a₁s + a₁t)/2 at `R`, band 2 × (2a₂s +
 * a₂t)/3 at `R` plus × (a₂s − a₂t)/3 at `T`; a round lobe is the zonal convolution, its bands
 * read once.
 */
export const REFLECTION_LOBE_WGSL = wgslBlock(
  'REFLECTION_LOBE_WGSL',
  [REFLECTION_BANDS_WGSL],
  `struct ReflectionLobe{R:vec3f,T:vec3f,bands:vec3f,widths:vec2f,}
fn reflectionLobeOf(R:vec3f,alpha:f32,lobe:vec4f)->ReflectionLobe{
 let s=reflectionBands(alpha);
 var t=s;
 if(lobe.w!=alpha){t=reflectionBands(lobe.w);}
 let across=lobe.xyz-R*dot(lobe.xyz,R);
 let T=across*inverseSqrt(max(dot(across,across),1e-30));
 return ReflectionLobe(R,T,vec3f(0.5*(s.x+t.x),(2.0*s.y+t.y)/3.0,(s.y-t.y)/3.0),vec2f(alpha,lobe.w));
}`,
)

/** The radiance around the scene through a lobe (`reflectionEnvironment`), one rule: a ray that
 *  leaves the scene reaches what the view shows in its direction. Where the scene declares a
 *  background, that is the background's radiance, the uniform radiance the view's `surroundings`
 *  give (`w` one), which every lobe keeps whole; where it declares none, the environment, its
 *  order-2 coefficients the diffuse term reads through the cosine lobe (`directLights.environment`),
 *  read through this lobe. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [REFLECTION_LOBE_WGSL, REFLECTION_VIEW_WGSL],
  `fn reflectionEnvironment(lobe:ReflectionLobe)->vec3f{
 if(reflectionView.surroundings.w!=0.0){return reflectionView.surroundings.rgb;}
 return ${lobeRadianceShader((k) => `directLights.environment[${k}].rgb`, 'lobe')};
}`,
)

/**
 * The bounce probes' radiance through a lobe, at a point of normal `N`
 * (`reflectionProbesGathered`): the cascades' field (`probeFieldWgsl`), each probe's coefficients
 * read through the lobe, never negative — its mean in `xyz` and the weight of the probes that
 * answered in `w`, at most one, which is the confidence of the field stage.
 */
export const REFLECTION_PROBES_WGSL = wgslBlock(
  'REFLECTION_PROBES_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    probeFieldWgsl(
      'reflectionProbes',
      'reflectionProbeLevel',
      ',lobe:ReflectionLobe',
      `max(vec3f(0.0),${lobeRadianceShader((k) => `probeAt(probe,${k}u).xyz`, 'lobe')})`,
    ),
  ],
  '',
)
