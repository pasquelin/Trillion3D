import type { BackendCapabilities, BackendDiagnostic } from '../../backend/types.ts';
import { MAX_EMITTERS } from './contracts.ts';
import type { ObservationResources } from './resources.ts';
import type { ObservationMeshes } from './meshes.ts';

export function createObservationCapabilities(): BackendCapabilities {
  return {
    renderer: 'Engine WebGL2 analytic transport experiment',
    materials:
      'Indirect irradiance cache plus per-pixel area-light visibility (16 or 64 stratified samples) and emission; mirror reflectance 0.92; metal GGX F0 0.92; full source meshes',
    hierarchy: false,
    gpuDriven: false,
    simplification: false,
    eviction: false,
    unsupported: [
      'general triangle ray tracing',
      'WebGPU implementation',
      'cluster selection and streaming performance',
      'specular transport back into the diffuse solver',
      'more than three specular interactions (black termination)',
      'environment outside declared scene (black)',
      'converged glossy integration (1..8 deterministic GGX samples)',
      'converged soft shadows (16/64 stratified samples retain spatial noise)',
      'cancellation within a submitted GPU draw',
      'transparent materials',
      'physical VRAM instrumentation',
    ],
  };
}
export function observationDiagnostic(
  resources: ObservationResources,
  meshes: ObservationMeshes,
): BackendDiagnostic {
  const { surfaceCount, patchCount, texels, surfaceTexels, uniforms, rayDiagnostics } = resources;
  const { triangles } = meshes;
  return {
    phase: 'lighting-experiment',
    message:
      'Analytic rectangle/sphere observation with per-pixel direct visibility and indirect cache',
    context: {
      surfaceCount,
      patchCount,
      triangles,
      cacheBytes: texels.byteLength,
      surfaceDataBytes: surfaceTexels.byteLength,
      cacheFiltering: 'manual bilinear indirect irradiance at patch centers',
      diffuse: 'emission + albedo * (indirect cache + per-pixel direct irradiance) / pi',
      directLightSamples: uniforms.directLightSamples,
      directLightSampling:
        'stratified jitter from pixel, receiver, stable emitter index and sample; no temporal seed',
      shadowTraversal: 'opaque any-hit; exhaustive reference or refitted rectangle AABB BVH',
      ...rayDiagnostics,
      bvhBounds: 'float32 rectangle coordinates; expanded by 1e-4 + 1e-6 * coordinate scale',
      bvhUpdate: 'fixed median topology; bottom-up refit only in BVH mode',
      directReferenceConverged: false,
      maxEmitters: MAX_EMITTERS,
      maxSpecularInteractions: 3,
      reflectionSamples: uniforms.reflectionSamples,
      specularF0: 0.92,
      primarySphereHit: 'analytic camera ray; normal-offset secondary origin',
      fullSourceGeometry: true,
    },
  };
}
