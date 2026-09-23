/** Experimental, diffuse-only transport. These versions describe data and algorithms separately. */
export const LIGHTING_TRANSPORT_FORMAT_VERSION = 1;
export const LIGHTING_TRANSPORT_ALGORITHM_VERSION = 'cosine-first-hit-v1';

/** How far the light-bounce solver has got. */
export interface TransportProgress {
  /** Event format version. */
  eventVersion: 1;
  /** The step it is in. */
  stage: 'geometry' | 'visibility' | 'solve' | 'oracle';
  /** Work done. */
  completed: number;
  /** Work in all. */
  total: number;
}
/** How the light-bounce solver runs. */
export interface TransportOptions {
  /** Total deterministic rays per patch; four origin samples share this budget. */
  raysPerPatch?: number;
  /** Most solver rounds. */
  maxIterations?: number;
  /** Absolute radiance error bound in the maximum norm, for the sampled operator. */
  tolerance?: number;
  /** Reuse the previous radiance in reuse mode (default true). False gives both modes identical solver initialization. */
  warmStart?: boolean;
  /** Most memory it may use. */
  maxBytes?: number;
  /** Its clock. */
  now?: () => number;
  /** Asks whether to stop. */
  cancelled?: () => boolean;
  /** Hears its progress. */
  onProgress?: (progress: TransportProgress) => void;
}
/** The light-bounce problem, frozen: how patches see each other. */
export interface TransportSnapshot {
  /** Data format version. */
  formatVersion: 1;
  /** Algorithm version. */
  algorithmVersion: typeof LIGHTING_TRANSPORT_ALGORITHM_VERSION;
  /** Patches in all. */
  patchCount: number;
  /** Row-major form factors: E = pi * matrix * radiance. */
  matrix: Float64Array;
  /** Light each patch gives off. */
  source: Float64Array;
  /** Light each patch reflects. */
  albedo: Float64Array;
}
/** What the light-bounce solver found: the light on every patch, and its cost. */
export interface TransportResult {
  /** Data format version. */
  formatVersion: 1;
  /** Built again, or reused. */
  mode: 'rebuild' | 'reuse';
  /** State-owned arrays, overwritten by later updates. Copy before retaining a frame. */
  radiance: Float64Array;
  /** Incident irradiance from all sampled surfaces, including the emissive panel. */
  irradiance: Float64Array;
  /** Incident irradiance after at least one diffuse reflection: pi * matrix * (radiance - source). */
  indirectIrradiance: Float64Array;
  /** Time spent, by step. */
  timings: { rayTraceMs: number; solveMs: number; totalMs: number };
  /** Rays whose static scene intersections were recalculated. */
  raysTraced: number;
  /** Reused static intersections; moving occluders may still have been tested. */
  raysReused: number;
  /** Tests against moving things. */
  movingRayTests: number;
  /** Tests against still surfaces. */
  staticSurfaceTests: number;
  /** Rays in all. */
  totalRays: number;
  /** Rows recomputed. */
  rowsUpdated: number;
  /** Solver rounds. */
  iterations: number;
  /** Error left. */
  residual: number;
  /** Largest possible error. */
  errorBound: number;
  /** How fast it converges. */
  contraction: number;
  /** Whether it reached the tolerance. */
  converged: boolean;
  /** Owned typed-array payload only, excluding JS objects and caller-owned scene data. */
  bytes: number;
  /** What it does not do yet. */
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
