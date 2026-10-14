import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_U32, PLASTIC_STEP, TWO_PI } from '../../../math/src/wgsl/constants.ts'
import { mixWord } from '../../../math/src/wgsl/sampling.ts'
import { tangentFallback } from '../../../math/src/wgsl/basis.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl } from './viewLayout.ts'

/** One lobe of normal `N`, width `alpha` across and `lobe.w` along `lobe.xyz`, read along its centre,
 *  the mirror direction about `N` (`reflectedRadianceAlong`, which the program holds). */
const reflectionCentreRadiance = wgslFn(
  'reflectionCentreRadiance',
  [],
  `fn reflectionCentreRadiance(P:vec3f,N:vec3f,V:vec3f,alpha:f32,lobe:vec4f)->vec3f{
 return reflectedRadianceAlong(P,N,V,reflect(-V,N),alpha,lobe);
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
 * THE GLOSSY LOBE, SAMPLED (`reflectionLobeRadiance`, the reflections' trace's): a lobe wider than a
 * mirror's casts its ray in a
 * direction drawn from its own GGX distribution instead of its centre, a new one every image, so that the
 * history's images (`temporalWgsl.ts`) and the neighbours' reuse (`spatialWgsl.ts`) average the whole lobe,
 * its long tail included, where one centre ray read it through a cone alone.
 *
 * - MIRROR: a lobe whose cone stays under a pixel over the whole screen march
 *   (`reflectionConeTangent(α)·REFLECTION_STEP_CAP < 1`, `reflectionSampled`) keeps its one centre ray:
 *   sampling it would only add noise.
 * - DIRECTION: the half-vector drawn by D(h)·(n·h) — the unit GGX slopes, r = √(u/(1 − u)) at the angle
 *   2πv, stretched by the lobe's widths along its axis and across (`reflectionSampleDirection`) —, the ray
 *   its mirror about it; one under the surface takes the centre. The split-sum weight the upsample applies
 *   assumes this very distribution of directions.
 * - CONE: each sampled ray keeps `REFLECTION_SAMPLE_CONE` of the lobe's width as its own cone, the
 *   sampling spreading the rest, √(1 − c²) of it: Gaussian-like widths add in quadrature, so the average
 *   reads the lobe's width, and each ray's footprint in the radiance pyramid and the probes is half as wide.
 * - SEQUENCE: (u, v) from the plastic number's two-dimensional additive sequence over the image's turn
 *   (`ReflectionView.temporal.x`), shifted by a hash of the texel (`mixWord`) so neighbours differ: a
 *   low-discrepancy set within each texel's history, a turning one across the grid.
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
    PLASTIC_STEP,
    TWO_PI,
    mixWord,
    tangentFallback,
    reflectionCentreRadiance,
  ],
  `fn reflectionSampled(alpha:f32)->bool{return reflectionConeTangent(alpha)*REFLECTION_STEP_CAP>=1.0;}
fn reflectionSampleAt(block:vec2u,layer:u32)->vec2f{
 let seed=mixWord(block.x^mixWord(block.y^(layer*GOLDEN_U32)));
 let shift=vec2f(f32(seed&0xffffu),f32(seed>>16u))/65536.0;
 return fract(shift+f32(reflectionView.temporal.x%REFLECTION_SEQUENCE)*PLASTIC_STEP);
}
fn reflectionSampleDirection(N:vec3f,V:vec3f,axis:vec3f,widths:vec2f,u:vec2f)->vec3f{
 var T=axis-N*dot(axis,N);
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
 if(!reflectionSampled(alpha)){return reflectionCentreRadiance(P,N,V,alpha,lobe);}
 let spread=sqrt(1.0-REFLECTION_SAMPLE_CONE*REFLECTION_SAMPLE_CONE);
 let R=reflectionSampleDirection(N,V,lobe.xyz,vec2f(lobe.w,alpha)*spread,u);
 return reflectedRadianceAlong(P,N,V,R,alpha*REFLECTION_SAMPLE_CONE,vec4f(lobe.xyz,lobe.w*REFLECTION_SAMPLE_CONE));
}`,
)
