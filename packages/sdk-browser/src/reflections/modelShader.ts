import { ROUGHNESS_FLOOR, shaderFloat } from '../lighting/shaderConstants.ts';
import { LTC_SIZE } from '../../../sdk-core/src/lighting/ltcTable.ts';
import { MODEL_FLAG, SURFACE_MODEL } from '../scene/surfaceModel.ts';
import { shaderLanguage } from './traceShader.ts';

/** One roughness sample of the lobe table: transition resolution, not a rough-lobe filter. */
export const MIRROR_TRANSITION_END = shaderFloat(Number(ROUGHNESS_FLOOR) + 1 / (LTC_SIZE - 1));
export const mirrorWeightShader = (language: 'wgsl' | 'glsl') =>
  shaderLanguage(
    `
fn mirrorWeight(rough:f32)->f32{
 return 1.0-smoothstep(${ROUGHNESS_FLOOR},${MIRROR_TRANSITION_END},rough);
}`,
    language,
  );

/** One split-sum mirror model for deferred, forward and both graphics APIs. */
export function mirrorLightingShader(language: 'wgsl' | 'glsl') {
  const flags = language === 'wgsl' ? MODEL_FLAG : SURFACE_MODEL;
  return shaderLanguage(
    `
fn mirrorLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(surfaceModel==${flags.diffuse}u||surfaceModel==${flags.toon}u){return vec3f(0.0);}
 var t:vec4f=ltcLookup(rough,clamp(dot(N,V),1e-4,1.0),1u);
 var f0:vec3f=mix(vec3f(0.04),rgb,metal);
 return (f0*t.x+(vec3f(1.0)-f0)*t.y)*reflectedRadiance(P,N,reflect(-V,N),rough);
}`,
    language,
  );
}
