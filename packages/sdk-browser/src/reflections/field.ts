import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { lobeRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { probeFieldWgsl } from '../bounce/gridWgsl.ts'
import { REFLECTION_VIEW_WGSL } from './viewLayout.ts'
import { SQRT2 } from '../../../math/src/wgsl/constants.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

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
 * The cone and the fades, pure functions of their arguments.
 *
 * `reflectionConeTangent`: tan of the half-angle of the reflected GGX lobe of width `alpha`
 * (rough², or a stretched lobe's α along its direction), twice the half-vector's angle at half the
 * distribution's peak — D(θ)/D(0) = ½ gives tan²θ = α²(√2 − 1)/(1 − √2 α²) —, the half-vector's
 * angle bounded at 40°: the half-maximum angle of a lobe past α² = 1/√2 does not exist, and a
 * half-vector at 45° reflects 90° off the centre, a tangent without bound; 40° keeps it finite
 * (tan 80°), a footprint far wider than the radiance pyramid's coarsest level, which the level
 * trust (`reflectionLevelTrust`) already gives up. Zero on a mirror.
 * `reflectionEdgeFade`: 1 inside the image of `size`, falling smoothly to 0 at its edge over
 * `REFLECTION_EDGE` of its height. `reflectionLevelTrust`: the screen's share by the footprint's
 * pyramid level against the pyramid's top one: 1 up to the level below the top, falling smoothly
 * to 0 at the top, whose texel spans the whole image.
 */
export const REFLECTION_CONE_WGSL = wgslBlock(
  'REFLECTION_CONE_WGSL',
  [REFLECTION_CONSTANTS_WGSL, SQRT2],
  `fn reflectionConeTangent(alpha:f32)->f32{
 let a2=alpha*alpha;
 let h=min(sqrt(a2*(SQRT2-1.0)/max(1.0-SQRT2*a2,1e-4)),REFLECTION_CONE_LIMIT);
 return 2.0*h/(1.0-h*h);
}
fn reflectionEdgeFade(pixel:vec2f,size:vec2f)->f32{
 let inside=clamp(min(pixel,size-pixel)/(REFLECTION_EDGE*size.y),vec2f(0.0),vec2f(1.0));
 let s=inside*inside*(3.0-2.0*inside);
 return s.x*s.y;
}
fn reflectionLevelTrust(level:f32,top:f32)->f32{return 1.0-smoothstep(top-1.0,top,level);}`,
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
 * read once. `tangents` are the cone's tangents at the two widths (`reflectionConeTangent`), computed
 * once a lobe; `reflectionReadTangent` is the tangent the footprint reads at — the short axis's, or
 * the long axis's share of `REFLECTION_TAPS` taps.
 */
export const REFLECTION_LOBE_WGSL = wgslBlock(
  'REFLECTION_LOBE_WGSL',
  [REFLECTION_BANDS_WGSL, REFLECTION_CONE_WGSL],
  `struct ReflectionLobe{R:vec3f,T:vec3f,bands:vec3f,widths:vec2f,tangents:vec2f,}
fn reflectionLobeOf(R:vec3f,alpha:f32,lobe:vec4f)->ReflectionLobe{
 let s=reflectionBands(alpha);
 let ts=reflectionConeTangent(alpha);
 var t=s;
 var tt=ts;
 if(lobe.w!=alpha){t=reflectionBands(lobe.w);tt=reflectionConeTangent(lobe.w);}
 let across=lobe.xyz-R*dot(lobe.xyz,R);
 let T=across*inverseSqrt(max(dot(across,across),1e-30));
 return ReflectionLobe(R,T,vec3f(0.5*(s.x+t.x),(2.0*s.y+t.y)/3.0,(s.y-t.y)/3.0),vec2f(alpha,lobe.w),vec2f(ts,tt));
}
fn reflectionReadTangent(lobe:ReflectionLobe)->f32{return max(lobe.tangents.x,lobe.tangents.y/REFLECTION_TAPS);}`,
)

/** The radiance around the scene (`reflectionEnvironment`), one rule: a ray that leaves the scene
 *  reaches what the screen draws in its direction, the background — the declared colour or the
 *  default one, drawn behind every image (the canvas is opaque) —, as the radiance the view's
 *  exposure and curve turn into it: the uniform radiance of the view's `surroundings`, which
 *  every lobe keeps whole. The environment's coefficients light the diffuse term alone. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [REFLECTION_VIEW_WGSL],
  `fn reflectionEnvironment()->vec3f{return reflectionView.surroundings.rgb;}`,
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
