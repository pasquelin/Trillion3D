import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_U32, TWO_PI } from '../../../math/src/wgsl/constants.ts'
import { additive2d, mixWord } from '../../../math/src/wgsl/sampling.ts'
import { highHalf, lowHalf } from '../../../math/src/wgsl/integer.ts'
import { tangentFallback } from '../../../math/src/wgsl/basis.ts'
import { vectorRejection } from '../../../math/src/wgsl/geometry.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl } from './viewLayout.ts'

/** A sampled ray of a lobe (`reflectionLobeRay`), what the chain's stages trace (`wgsl.ts`): its
 *  direction `R`, the thin lobe it is read through — the lobe's long axis and the smoothest α
 *  (`axis`) —, `width`, the narrower α of the lobe it stands for, and that lobe's widths across
 *  (`alpha`) and along its axis (`along`). */
export const REFLECTION_LOBE_RAY_WGSL = wgslBlock(
  'REFLECTION_LOBE_RAY_WGSL',
  [],
  'struct ReflectionLobeRay{R:vec3f,axis:vec4f,width:f32,alpha:f32,along:f32,}',
)

/**
 * EVERY LOBE, SAMPLED (`reflectionLobeRay`, the trace's kernels', `u` turning per pixel and per image,
 * `reflectionSampleAt`): every lobe that traces (`reach.ts`) casts its ray in a direction drawn from its
 * own GGX distribution, a new one every image,
 * so that the history's images (`temporalWgsl.ts`) and the neighbours' reuse (`resolveWgsl.ts`) average
 * the whole lobe, its long tail included. A mirror is the limit: its widths at the smoothest lobe the
 * engine draws, its draws all within a fraction of a degree of its centre — its sample is its centre
 * ray, with no rule of its own.
 *
 * - DIRECTION: the half-vector drawn among the normals the eye sees (`reflectionSampleDirection`): the
 *   view stretched by the lobe's widths along its axis and across, a direction drawn on the spherical cap
 *   the visible normals cover — its height drawn over all but the `REFLECTION_TAIL_BIAS` of it nearest
 *   the horizon, the grazing microfacets whose rays are the noisiest and dimmest —, unstretched; the ray
 *   its mirror about it, pdf D(h)·G₁(v) / (4 n·v), which the reuse weighs by (`resolveWgsl.ts`). A ray
 *   that would leave under the surface is folded back above it: never the lobe's centre, a spike.
 * - THIN RAYS: each ray is read through the cone of the smoothest lobe the engine draws (`lobeAlpha(0)`,
 *   under a pixel over the whole march), so the mean of the rays is the lobe's own. A wider cone with a
 *   narrower draw is not: GGX slopes have no variance, widths do not add in quadrature, and a draw
 *   narrowed by √(1 − c²) takes near a quarter of the tail's mass three widths out (c = ½: P(|s| > 3α)
 *   falls from 1/10 to 1/13) — the radiance a small bright body brings to the lobe's edge.
 * - SEQUENCE: (u, v) from the plastic number's two-dimensional additive sequence over the image's turn
 *   (`ReflectionView.temporal.x`), shifted by a hash of the texel or the pixel (`mixWord`) so neighbours
 *   differ: a low-discrepancy set within each texel's history, a turning one across the grid.
 *
 * The lobe a pixel traces is its top layer's, the coat's where it carries one (`reflectionTopRay`,
 * `weight.ts`), sampled the same way.
 */
export const REFLECTION_SAMPLE_WGSL = wgslBlock(
  'REFLECTION_SAMPLE_WGSL',
  [
    reflectionBindingsWgsl(REFLECTION_GROUP),
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_CONE_WGSL,
    GOLDEN_U32,
    TWO_PI,
    mixWord,
    additive2d,
    lowHalf,
    highHalf,
    tangentFallback,
    vectorRejection,
    LOBE_AXIS_WGSL,
    REFLECTION_LOBE_RAY_WGSL,
  ],
  `fn reflectionSampleAt(block:vec2u,layer:u32)->vec2f{
 let seed=mixWord(block.x^mixWord(block.y^(layer*GOLDEN_U32)));
 let shift=vec2f(f32(lowHalf(seed)),f32(highHalf(seed)))/65536.0;
 return additive2d(shift,reflectionView.temporal.x);
}
fn reflectionSampleDirection(N:vec3f,V:vec3f,axis:vec3f,widths:vec2f,u:vec2f)->vec3f{
 var T=vectorRejection(axis,N);
 if(dot(T,T)<1e-12){T=tangentFallback(N);}
 T=normalize(T);
 let B=cross(N,T);
 let seen=normalize(vec3f(widths*vec2f(dot(V,T),dot(V,B)),max(dot(V,N),1e-4)));
 let phi=TWO_PI*u.x;
 let z=mix(1.0,-seen.z,u.y*(1.0-REFLECTION_TAIL_BIAS));
 let sine=sqrt(clamp(1.0-z*z,0.0,1.0));
 let cap=vec3f(sine*cos(phi),sine*sin(phi),z)+seen;
 let h=normalize(vec3f(widths*cap.xy,max(cap.z,0.0)));
 let L=reflect(-V,normalize(h.x*T+h.y*B+h.z*N));
 return L-2.0*min(dot(L,N),0.0)*N;
}
fn reflectionLobeRay(N:vec3f,V:vec3f,alpha:f32,lobe:vec4f,u:vec2f)->ReflectionLobeRay{
 let R=reflectionSampleDirection(N,V,lobe.xyz,vec2f(lobe.w,alpha),u);
 let thin=lobeAlpha(0.0);
 return ReflectionLobeRay(R,vec4f(lobe.xyz,thin),min(alpha,lobe.w),alpha,lobe.w);
}`,
)
