import { environmentReflectionShader } from './environmentShader.ts';

/** The scene environment's order-2 radiance (\`directLights.environment\`) through the GGX lobe
 *  (\`environmentShader.ts\`): the WebGPU programs' last fallback, never black (#1341). */
export const ENVIRONMENT_REFLECTION_WGSL = environmentReflectionShader('wgsl', {
  prelude: 'let e=directLights.environment;',
  direction: 'R',
  coefficient: (k) => `e[${k}].rgb`,
});

/** The existing order-2 radiance probes convolved with the same GGX kernel moments
 *  (\`reflectionProbeBands\`). The mirror continues to trace the proxy. */
export const PROBE_REFLECTION_FILTER_WGSL = `${ENVIRONMENT_REFLECTION_WGSL}
var<private> probeSpecularHeld:bool;
var<private> probeSpecularAt:array<vec4u,2>;
var<private> probeSpecularRay:vec4u;
var<private> probeSpecular:vec3f;
/** Keeps the filtered reflection the resolve's single field walk gathered (\`sampleProbeFields\`)
 *  for this point, normal, direction and roughness, which \`filteredProbeReflection\` returns for the
 *  very same bits instead of walking the probes again. */
fn holdProbeSpecular(P:vec3f,N:vec3f,R:vec3f,rough:f32,specular:vec3f){
 probeSpecularHeld=true;probeSpecular=specular;
 probeSpecularAt=array(bitcast<vec4u>(vec4f(P,0.0)),bitcast<vec4u>(vec4f(N,0.0)));
 probeSpecularRay=bitcast<vec4u>(vec4f(R,rough));
}
fn filteredProbeReflection(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 if(probeSpecularHeld&&all(bitcast<vec4u>(vec4f(P,0.0))==probeSpecularAt[0])&&all(bitcast<vec4u>(vec4f(N,0.0))==probeSpecularAt[1])&&all(bitcast<vec4u>(vec4f(R,rough))==probeSpecularRay)){return probeSpecular;}
 return sampleProbeField(P,N,R,reflectionProbeBands(rough),true);
}`;
