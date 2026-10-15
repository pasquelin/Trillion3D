import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_U32, TWO_PI } from '../../../math/src/wgsl/constants.ts'
import { additive2d, mixWord } from '../../../math/src/wgsl/sampling.ts'
import { highHalf, lowHalf } from '../../../math/src/wgsl/integer.ts'
import { tangentFallback } from '../../../math/src/wgsl/basis.ts'
import { vectorRejection } from '../../../math/src/wgsl/geometry.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl } from './viewLayout.ts'

/** One lobe of normal `N`, width `alpha` across and `lobe.w` along `lobe.xyz`, read along its centre,
 *  the mirror direction about `N` (`reflectedRadianceAlong`, which the program holds). */
const reflectionCentreRadiance = wgslFn(
  'reflectionCentreRadiance',
  [],
  `fn reflectionCentreRadiance(P:vec3f,N:vec3f,V:vec3f,alpha:f32,lobe:vec4f)->vec3f{
 return reflectedRadianceAlong(P,N,V,reflect(-V,N),alpha,lobe,min(alpha,lobe.w));
}`,
)

/** Every lobe read along its centre (`reflectionLobeRadiance`): every program but the reflections'
 *  trace, `u` unread. */
export const REFLECTION_CENTRE_WGSL = wgslBlock(
  'REFLECTION_CENTRE_WGSL',
  [reflectionCentreRadiance],
  `fn reflectionLobeRadiance(P:vec3f,N:vec3f,V:vec3f,alpha:f32,lobe:vec4f,u:vec2f)->vec3f{
 return reflectionCentreRadiance(P,N,V,alpha,lobe);
}`,
)

/**
 * EVERY LOBE, SAMPLED (`reflectionLobeRadiance`, the reflections' trace's): every lobe, whatever its
 * roughness, casts its ray in a direction drawn from its own GGX distribution, a new one every image,
 * so that the history's images (`temporalWgsl.ts`) and the neighbours' reuse (`spatialWgsl.ts`) average
 * the whole lobe, its long tail included. A mirror is the limit: its widths at the smoothest lobe the
 * engine draws, its draws all within a fraction of a degree of its centre — its sample is its centre
 * ray, with no rule of its own.
 *
 * - DIRECTION: the half-vector drawn by D(h)·(n·h) — the unit GGX slopes, r = √(u/(1 − u)) at the angle
 *   2πv, stretched by the lobe's widths along its axis and across (`reflectionSampleDirection`) —, the ray
 *   its mirror about it; one under the surface takes the centre. The split-sum weight the upsample applies
 *   assumes this very distribution of directions.
 * - THIN RAYS: each ray is read through the cone of the smoothest lobe the engine draws (`lobeAlpha(0)`,
 *   under a pixel over the whole march), so the mean of the rays is the lobe's own. A wider cone with a
 *   narrower draw is not: GGX slopes have no variance, widths do not add in quadrature, and a draw
 *   narrowed by √(1 − c²) takes near a quarter of the tail's mass three widths out (c = ½: P(|s| > 3α)
 *   falls from 1/10 to 1/13) — the radiance a small bright body brings to the lobe's edge.
 * - SEQUENCE: (u, v) from the plastic number's two-dimensional additive sequence over the image's turn
 *   (`ReflectionView.temporal.x`), shifted by a hash of the texel or the pixel (`mixWord`) so neighbours
 *   differ: a low-discrepancy set within each texel's history, a turning one across the grid.
 *
 * The coat's lobe is sampled the same way, its pair of numbers swapped (`reflectionTrace`).
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
 let r=sqrt(u.x/max(1.0-u.x,1e-6));
 let a=TWO_PI*u.y;
 let slope=r*vec2f(cos(a),sin(a))*widths;
 let L=reflect(-V,normalize(N+slope.x*T+slope.y*B));
 return select(reflect(-V,N),L,dot(L,N)>0.0);
}
fn reflectionLobeRadiance(P:vec3f,N:vec3f,V:vec3f,alpha:f32,lobe:vec4f,u:vec2f)->vec3f{
 let R=reflectionSampleDirection(N,V,lobe.xyz,vec2f(lobe.w,alpha),u);
 let thin=lobeAlpha(0.0);
 return reflectedRadianceAlong(P,N,V,R,thin,vec4f(lobe.xyz,thin),min(alpha,lobe.w));
}`,
)
