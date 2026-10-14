/**
 * Indirect bounce lighting: published parameters and bounded limits.
 *
 * The proxy is a coarse global geometry representation — one proxy a mesh, built at cook time, and a cut's
 * built where the world made it — placed by the culling's worlds and independent of camera view; probes trace
 * rays against it, never against the visible cut. Accumulated irradiance
 * modulates the opaque deferred pass multiplied by surface albedo.
 *
 * Light requires declared sources: without active lights, indirect irradiance is strictly zero.
 */

/** Rays a probe traces an update, and the most probe rays a frame casts (`BOUNCE_SETTINGS`). */
const RAYS_PER_PROBE = 64
const RAYS_PER_FRAME = 49152

/** Bounce lighting settings. Published operational limits consumed by the runtime engine. */
export const BOUNCE_SETTINGS = {
  /**
   * Certified geometric error floor of a cluster retained in the proxy, in meters.
   * The actual threshold doubles until the cut fits within the triangle budget.
   */
  proxyErrorMetres: 0.05,
  /** Total triangle budget of the meshes' proxies of a scene, each mesh counted once whatever its instances. */
  proxyTriangleBudget: 300_000,
  /** Triangles per BVH leaf: leaf traversal loops are bounded by this constant. */
  proxyLeafTriangles: 8,
  /**
   * Visited BVH nodes per ray on the tree as built, bounded before frame execution. A refit
   * adds the nodes it let into a ray, never the node count (`bounce/runtimeSceneWgsl.ts`).
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
  raysPerProbe: RAYS_PER_PROBE,
  /** Maximum probe rays per frame: static ceiling bounding compute dispatch size. */
  raysPerFrame: RAYS_PER_FRAME,
  /** Target GPU duration of every proxy ray of a frame, in milliseconds: the reflections' first,
   *  the bounce probes' the rest (`../proxy/budget.ts`). */
  budgetMs: 2,
  /** The probes' part of `budgetMs` at most, reflections or none: alone, they aim at 0.8 ms of
   *  2, the frame time they had before the reflections shared the budget. */
  probeShare: 0.4,
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
} as const

/**
 * Maximum probes updated per frame: ray budget ceiling divided by rays per probe, whole probes.
 * Plain arithmetic on the two constants, no call nor read of the settings: a bundle that uses no
 * bounce keeps neither this nor `BOUNCE_SETTINGS`.
 */
export const BOUNCE_PROBES_PER_FRAME =
  (RAYS_PER_FRAME - (RAYS_PER_FRAME % RAYS_PER_PROBE)) / RAYS_PER_PROBE

/**
 * Probe floats layout in GPU storage buffer: 11 × `vec4f`.
 *
 * 9 vectors store spherical harmonics L2 coefficients (constant, 3 linear, 5 quadratic);
 * 2 vectors store 6 directional mean visibility distances. The `w` components store probe state.
 */
export const PROBE_FLOATS = 44
