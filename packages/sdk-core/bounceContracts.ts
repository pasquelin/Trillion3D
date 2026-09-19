/**
 * Indirect bounce lighting: published parameters and bounded limits.
 *
 * The proxy mesh is a coarse global geometry representation built at cook time and independent of
 * camera view; probes trace rays against it, never against the visible cut. Accumulated irradiance
 * modulates the opaque deferred pass multiplied by surface albedo.
 *
 * Light requires declared sources: without active lights, indirect irradiance is strictly zero.
 */

/** Bounce lighting settings. Published operational limits consumed by the runtime engine. */
export const BOUNCE_SETTINGS = {
  /**
   * Certified geometric error floor of a cluster retained in the proxy, in meters.
   * The actual threshold doubles until the cut fits within the triangle budget.
   */
  proxyErrorMetres: 0.05,
  /** Total proxy triangle budget for a full scene across all instances: resident footprint. */
  proxyTriangleBudget: 300_000,
  /**
   * Proxy mesh resolution floor in meters: size of simplified triangles / surface cache cells.
   * Doubled by the compiler if budget is exceeded.
   */
  proxyCellMetres: 0.5,
  /** Triangles per BVH leaf: leaf traversal loops are bounded by this constant. */
  proxyLeafTriangles: 8,
  /**
   * Visited BVH nodes per ray: bounded before frame execution, never dynamic.
   * A 4-wide node covers 4× more tree per step than a binary BVH.
   */
  traversalSteps: 128,
  /**
   * Traversal stack depth. A 4-wide node pushes up to 3 children; 32 covers millions of triangles.
   */
  traversalStack: 32,
  /**
   * Probe cascade levels. The first `cascadeLevels - 1` track camera position;
   * the final level is world-static covering full scene bounds.
   */
  cascadeLevels: 4,
  /** Probes per axis per level: a level is a cube of `cascadeSize³` probes. */
  cascadeSize: 16,
  /**
   * Spacing ceiling for finest cascade level in meters.
   */
  cascadeSpacingMetres: 2,
  /**
   * Minimum probe layers across the smallest scene dimension.
   */
  cascadeLayersAcross: 3,
  /**
   * Budget share per level, finest to coarsest. The finest level surrounds the camera and receives
   * the largest proportion of ray allocations.
   */
  cascadeShares: [8, 4, 2, 1],
  /** Rays traced per probe per update. Fixed configurable budget. */
  raysPerProbe: 64,
  /** Maximum probe rays per frame: static ceiling bounding compute dispatch size. */
  raysPerFrame: 49152,
  /** Lights tested per surface cache cell. */
  lightsPerRay: 4,
  /** Surface cache cells updated per frame ceiling. */
  surfaceTexelsPerFrame: 16384,
  /** Target duration of bounce pass on GPU per frame, in milliseconds. */
  budgetMs: 0.8,
  /** Error correction share retained per sample to prevent oscillations. */
  budgetSmoothing: 0.25,
  /** Workload fraction floor: minimum progress guarantee. */
  budgetFloor: 0.02,
  /** Minimum blend weight for a settled probe. */
  blendStable: 0.2,
  /** Blend weight for a moving probe. */
  blendMoving: 0.8,
  /** Relative residual threshold flagging probe motion. */
  movingResidual: 0.05,
  /** Full convergence sweeps without change after which pass skips encoding. */
  settledSweeps: 16,
  /** Distance ratio under which a probe flags as embedded inside geometry. */
  buriedFraction: 0.15,
  /** Distance ratio flagging a probe in open sky. */
  skyFraction: 0.98,
  /** Visibility test margin as fraction of level spacing. */
  visibilityMargin: 0.6,
  /** Surface normal offset bias as fraction of level spacing. */
  normalBias: 0.35,
  /** Probe ray reach as fraction of scene bounding diagonal. */
  rayReachFraction: 1,
} as const;

/**
 * Maximum probes updated per frame: ray budget ceiling divided by rays per probe.
 */
export const BOUNCE_PROBES_PER_FRAME = Math.max(
  1,
  Math.floor(BOUNCE_SETTINGS.raysPerFrame / BOUNCE_SETTINGS.raysPerProbe),
);

/**
 * Probe floats layout in GPU storage buffer: 11 × `vec4f`.
 *
 * 9 vectors store spherical harmonics L2 coefficients (constant, 3 linear, 5 quadratic);
 * 2 vectors store 6 directional mean visibility distances. The `w` components store probe state.
 */
export const PROBE_FLOATS = 44;
