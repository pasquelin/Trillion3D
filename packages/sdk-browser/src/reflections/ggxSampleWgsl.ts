import { TWO_PI } from '../../../math/src/wgsl/constants.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { tangentAround } from '../../../math/src/wgsl/basis.ts'

/** GGX importance sampling of the split-sum radiance prefilter (N = V = R).
 * A sampled half-vector has PDF D(H) N.H; reflection changes measure by 4 V.H.
 * The ratio estimator's kernel D(H) N.L / 4 therefore has weight N.L here.
 * The alpha channel carries that weight, not opacity or accumulated sample count.
 * There is one ray at most; a direction below the mirror ray's horizon, or into the receiver's
 * own surface (behind its normal `N`), contributes zero weight: the surface stops it. Weighed by
 * the mirror ray alone, a rough lobe's directions under a floor seen low — a third of its weight at
 * roughness 0.3 — read what lies about the receiver on the screen. D is the engine's
 * \`ggxDistribution\` of \`STANDARD_LIGHTING_WGSL\`. */
export const GGX_REFLECTION_SAMPLE_WGSL = wgslBlock(
  'GGX_REFLECTION_SAMPLE_WGSL',
  [TWO_PI, tangentAround, STANDARD_LIGHTING_WGSL],
  `
fn stochasticReflection(R:vec3f,N:vec3f,rough:f32,xi:vec2f)->vec4f{
 let alpha=rough*rough;let a2=alpha*alpha;
 let cosine=sqrt((1.0-xi.y)/(1.0+(a2-1.0)*xi.y));
 let sine=sqrt(max(0.0,1.0-cosine*cosine));
 let phi=TWO_PI*xi.x;
 let T=tangentAround(R);let B=cross(R,T);
 let H=T*(cos(phi)*sine)+B*(sin(phi)*sine)+R*cosine;
 let L=reflect(-R,H);
 let distribution=ggxDistribution(a2,cosine,sine*sine);
 let pdf=distribution*cosine/(4.0*max(dot(R,H),1e-20));
 let kernel=distribution*max(dot(R,L),0.0)*0.25*select(0.0,1.0,dot(N,L)>0.0);
 return vec4f(L,kernel/max(pdf,1e-20));
}
`,
)
