/** Experimental, diffuse-only transport. These versions describe data and algorithms separately. */
export const LIGHTING_TRANSPORT_FORMAT_VERSION = 1;
export const LIGHTING_TRANSPORT_ALGORITHM_VERSION = 'cosine-first-hit-v1';

export interface TransportProgress {
  eventVersion: 1;
  stage: 'geometry' | 'visibility' | 'solve' | 'oracle';
  completed: number;
  total: number;
}
export interface TransportOptions {
  /** Total deterministic rays per patch; four origin samples share this budget. */
  raysPerPatch?: number;
  maxIterations?: number;
  /** Absolute radiance error bound in the maximum norm, for the sampled operator. */
  tolerance?: number;
  /** Reuse the previous radiance in reuse mode (default true). False gives both modes identical solver initialization. */
  warmStart?: boolean;
  maxBytes?: number;
  now?: () => number;
  cancelled?: () => boolean;
  onProgress?: (progress: TransportProgress) => void;
}
export interface TransportSnapshot {
  formatVersion: 1;
  algorithmVersion: typeof LIGHTING_TRANSPORT_ALGORITHM_VERSION;
  patchCount: number;
  /** Row-major form factors: E = pi * matrix * radiance. */
  matrix: Float64Array;
  source: Float64Array;
  albedo: Float64Array;
}
export interface TransportResult {
  formatVersion: 1;
  mode: 'rebuild' | 'reuse';
  /** State-owned arrays, overwritten by later updates. Copy before retaining a frame. */
  radiance: Float64Array;
  /** Incident irradiance from all sampled surfaces, including the emissive panel. */
  irradiance: Float64Array;
  /** Incident irradiance after at least one diffuse reflection: pi * matrix * (radiance - source). */
  indirectIrradiance: Float64Array;
  timings: { rayTraceMs: number; solveMs: number; totalMs: number };
  /** Rays whose static scene intersections were recalculated. */
  raysTraced: number;
  /** Reused static intersections; moving occluders may still have been tested. */
  raysReused: number;
  movingRayTests: number;
  staticSurfaceTests: number;
  totalRays: number;
  rowsUpdated: number;
  iterations: number;
  residual: number;
  errorBound: number;
  contraction: number;
  converged: boolean;
  /** Owned typed-array payload only, excluding JS objects and caller-owned scene data. */
  bytes: number;
  unsupported: readonly [
    'hierarchical transport',
    'adjoint scheduling',
    'specular-to-diffuse transport',
  ];
}

export class LightingTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'LightingTransportError';
  }
}
