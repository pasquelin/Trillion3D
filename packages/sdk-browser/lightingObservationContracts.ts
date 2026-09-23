import type { Scene } from '../sdk-core/src/lighting/scene/experimentScene.ts';

export interface LightingExperimentRayDiagnostics {
  rayTraversal: 'brute' | 'bvh';
  bvhNodeCount: number;
  /** Packed node payload; not a physical VRAM measurement. */
  bvhNodeBytes: number;
  /** Last render's CPU refit duration; zero when the exhaustive path is active. */
  bvhRefitMs: number;
}

/** Mutable solver output. Array references may be replaced between render calls. */
export interface LightingExperimentRenderState {
  scene: Scene;
  /** Incident irradiance excluding emitted source radiance: pi * T * (L - Le). */
  indirectIrradiance: Float64Array;
  radiance: Float64Array;
  exposure?: number;
  /** Deterministic GGX samples per pixel; integer in [1, 8], default 8. */
  reflectionSamples?: number;
  /** Per-emitter stratified shadow samples. 64 is a reference mode, not a convergence guarantee. */
  directLightSamples?: 16 | 64;
  /** Exhaustive reference stays the default until the host validates its BVH comparison. */
  rayTraversal?: 'brute' | 'bvh';
  /** Backend-owned output object, reused and updated every render. */
  rayDiagnostics?: LightingExperimentRayDiagnostics;
}

export const MAX_SURFACES = 256,
  MAX_CACHE_DIMENSION = 4096,
  MAX_REFLECTION_SAMPLES = 8,
  MAX_EMITTERS = 8,
  MAX_DIRECT_SAMPLES = 64;
