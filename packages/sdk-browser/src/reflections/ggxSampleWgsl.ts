import { PI, TWO_PI } from '../lighting/shaderConstants.ts';

/** GGX importance sampling of the split-sum radiance prefilter (N = V = R).
 * Stachowiak, Stochastic SSR, SIGGRAPH 2015: https://h3.gd/stochastic-ssr/.
 * A sampled half-vector has PDF D(H) N.H; reflection changes measure by 4 V.H.
 * The ratio estimator's kernel D(H) N.L / 4 therefore has weight N.L here.
 * The alpha channel carries that weight, not opacity or accumulated sample count.
 * There is one ray at most; a below-horizon direction contributes zero weight. */
export const GGX_REFLECTION_SAMPLE_WGSL = `
fn stochasticReflection(R:vec3f,rough:f32,xi:vec2f)->vec4f{
 let alpha=rough*rough;let a2=alpha*alpha;
 let cosine=sqrt((1.0-xi.y)/(1.0+(a2-1.0)*xi.y));
 let sine=sqrt(max(0.0,1.0-cosine*cosine));
 let phi=${TWO_PI}*xi.x;
 var axis=vec3f(0.0,0.0,1.0);if(abs(R.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 let T=normalize(cross(axis,R));let B=cross(R,T);
 let H=T*(cos(phi)*sine)+B*(sin(phi)*sine)+R*cosine;
 let L=reflect(-R,H);
 let denominator=cosine*cosine*(a2-1.0)+1.0;
 let distribution=a2/(${PI}*denominator*denominator);
 let pdf=distribution*cosine/(4.0*max(dot(R,H),1e-20));
 let kernel=distribution*max(dot(R,L),0.0)*0.25;
 return vec4f(L,kernel/max(pdf,1e-20));
}
`;
