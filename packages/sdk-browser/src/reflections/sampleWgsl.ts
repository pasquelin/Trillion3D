import { SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts';
import { HASH_UNIT_WGSL } from '../math/hashUnitWgsl.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { withScreenReflections } from './screenWgsl.ts';
import { GGX_REFLECTION_SAMPLE_WGSL } from './ggxSampleWgsl.ts';

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
