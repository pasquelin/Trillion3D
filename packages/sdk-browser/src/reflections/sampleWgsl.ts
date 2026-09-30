import { SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts';
import { HASH_UNIT_WGSL } from '../math/hashUnitWgsl.ts';
import { PI, ROUGHNESS_FLOOR, TWO_PI } from '../lighting/shaderConstants.ts';
import { withScreenReflections } from './screenWgsl.ts';

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
const STOCHASTIC_REFLECTION_WGSL = `${GGX_REFLECTION_SAMPLE_WGSL}
@fragment fn traceRoughReflection(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);let flag=textureLoad(flags,at,0).r&${SURFACE_MODEL_MASK}u;
 if(flag==0u||flag==1u||flag==3u||flag==4u||flag==5u){return vec4f(0.0);}
 let nr=textureLoad(normalRough,at,0);
 // Mirrors take the exact ray; past the cutoff the display reads the environment alone (#1341).
 if(nr.a<=${ROUGHNESS_FLOOR}||screenReflectionFade(nr.a)==0.0){return vec4f(0.0);}
 let P=worldAt(pixel.xy,textureLoad(depth,at,0));
 shadowFootprint=length(worldAt(pixel.xy+vec2f(1.0,0.0),textureLoad(depth,at,0))-P);
 shadowRequesting=all(vec2u(pixel.xy)<textureDimensions(depth));
 let N=normalize(nr.xyz);let V=normalize(view.camera.xyz-P*view.camera.w);
 let seed=bitcast<u32>(reflectionView.enabled.w);
 let pixelSeed=u32(pixel.y)*u32(reflectionView.enabled.y)+u32(pixel.x);
 // Integer rank and source epoch are mixed by the caller, independent of wall clock.
 let xi=vec2f(hashUnit(pixelSeed^seed),hashUnit(pixelSeed^seed^0x9e3779b9u));
 let sample=stochasticReflection(reflect(-V,N),nr.a,min(xi,vec2f(0.99999994)));
 if(sample.w<=0.0){return vec4f(0.0);}
 return vec4f(resolvedReflectionRay(P,N,sample.xyz),sample.w);
}`;

/** The trace borrows the same lighting/proxy bindings as the final resolve. */
export function stochasticReflectionShader(shader: string) {
  const source = withScreenReflections(shader);
  return (
    source + (source.includes('fn hashUnit(') ? '' : HASH_UNIT_WGSL) + STOCHASTIC_REFLECTION_WGSL
  );
}
