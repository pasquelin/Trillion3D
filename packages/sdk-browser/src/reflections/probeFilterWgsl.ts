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
fn filteredProbeReflection(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 return sampleProbeField(P,N,R,reflectionProbeBands(rough),true);
}`;
