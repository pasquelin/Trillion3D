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
   * adds the nodes it let into a ray, never the node count (`runtime/runtimeSceneWgsl.ts`).
   * A 4-wide node covers 4× more tree per step than a binary BVH.
   */
  traversalSteps: 128,
  /**
   * Traversal stack depth. A 4-wide node pushes up to 3 children; 32 covers millions of triangles.
   */
  traversalStack: 32,
  /**
   * Levels of probes, each a cube centred on the eye and snapped to its own cells, each cell twice
   * the one before (`cascadeBase`). Beyond the last, the sky light answers.
   */
  cascadeLevels: 4,
  /**
   * Cells along an axis of a level: a level is a cube of `cascadeSize³` cells, and holds a probe in
   * a cell only while the image reads it (`probePool`).
   */
  cascadeSize: 48,
  /**
   * Half the extent of the first level, in metres: from the eye to a side of its cube. Its cell is
   * twice that over `cascadeSize`, 1.04 m by default; the next levels' cells are 2.08, 4.17 and 8.33 m.
   */
  cascadeHalfExtentMetres: 25,
  /** Growth of a level's cell over the level before it. */
  cascadeBase: 2,
  /**
   * Probes alive at once, whatever the scene and the view: a cell the image reads takes one from this
   * pool and gives it back when it is no longer read or leaves its level. 128 rows of 128 probes.
   */
  probePool: 16384,
  /**
   * Marks a cell survives without being read by the image: its probe is given back after that many.
   * A cell a probe's ray hit is kept while its level holds it, whatever the image reads.
   */
  probeKeptMarks: 8,
  /**
   * Pixels along the side of a tile of the image: each tile marks, at every mark, the eight cells
   * around the visible surface point it holds, a point that moves from one mark to the next.
   */
  markTilePixels: 16,
  /** Marks a view change owes, the jitter of a tile's point taking as many to come round. */
  markJitter: 8,
  /**
   * Cells along an axis of the world light grid, a cube over the scene's extent whose lists the rays
   * of the probes and of the reflections walk (`lighting/bounce/worldLightLists.ts`).
   */
  lightGridSide: 16,
  /** Rays traced per probe per update. Fixed configurable budget. */
  raysPerProbe: RAYS_PER_PROBE,
  /** Maximum probe rays per frame: static ceiling bounding compute dispatch size. */
  raysPerFrame: RAYS_PER_FRAME,
  /**
   * Probes a frame traces: a count, the refresh's budget, in the cost of a whole map each (a probe past the downsample distance costs a
   * quarter of one, `probePlan.ts`). The default is the row of the default level of the screen probes
   * (`radianceProbeBudget` of `SCREEN_PROBE_LEVEL_KNOBS`; each level holds its own, scaled by `screenProbeUpdateSpeed`), what a host that
   * names none gets. A probe never traced comes before every refresh and is never held back, up to the queue (`BOUNCE_PROBE_QUEUE`),
   * and past what the budget has room for at a quarter of a map (`sdk-core/src/bounce/probePlan.ts`). The host sets it with
   * `bounceProbesPerFrame`.
   */
  probesPerFrame: 150,
  /**
   * Whether a probe's fresh estimate is filtered with its six neighbours' before it is kept
   * (`lighting/bounce/probes/probeFilterWgsl.ts`): the neighbours' light weighs in as far as their rays,
   * in the same directions, ended where this probe's did (`filterHitAngle`), and where nothing stands
   * between them.
   */
  filterProbes: true,
  /**
   * The angle, in radians, between a probe's ray and the direction to where its neighbour's ray in the
   * same direction ended, at which the neighbour's light weighs nothing: a wider angle filters more of
   * the surfaces near the probes, and leaks more across them.
   */
  filterHitAngle: 0.2,
  /** Minimum blend weight for a settled probe. */
  blendStable: 0.2,
  /** Blend weight for a moving probe. */
  blendMoving: 0.8,
  /** Relative residual threshold flagging probe motion. */
  movingResidual: 0.05,
  /** Updates a probe takes after a light changed, past which it is left alone and the pass skips encoding. */
  settledTraces: 16,
  /** Distance ratio under which a probe flags as embedded inside geometry. */
  buriedFraction: 0.15,
  /** Distance ratio flagging a probe in open sky. */
  skyFraction: 0.98,
  /** Visibility test margin as fraction of level spacing. */
  visibilityMargin: 0.6,
  /** Surface normal offset bias as fraction of level spacing. */
  normalBias: 0.35,
  /**
   * Where a bounce point's shadow ray starts, in metres along the light, off the point: this far where the
   * surface faces the light. A lamp's ray ends this far short of the lamp, so a surface the lamp stands
   * against does not shade the point.
   */
  shadowBiasMetres: 0.02,
  /** The shadow ray starts up to this much further along the light, in metres, where the surface grazes it. */
  shadowBiasSlopeMetres: 0.04,
  /** Probe ray reach as fraction of scene bounding diagonal. */
  rayReachFraction: 1,
  /**
   * The furthest a ray looks for a surface, in metres, whatever the scene's size: past it the ray has
   * left the scene, and the sky light answers. A ray, and the shadow ray its hit casts, are cut at
   * this distance. 200 m by default.
   */
  rayReachMetres: 200,
  /**
   * Units of work and triangle tests a probe's ray may spend (`runtime/runtimeLayout.ts`, `RAY_WORK`): a unit
   * a box tested, a node visited, a triangle tested. A street's rays cross many overlapping boxes: a ray
   * that spends them has not finished, which counts as a hit, so the budget is the whole of what the probes
   * can learn of the surfaces. The shadow rays its hits cast spend their own (`shadowRayWork`).
   */
  probeRayWork: 4096,
  probeRayTriangles: 1024,
  /**
   * Units of work and triangle tests one shadow ray, cast from the hit of a probe's ray, may spend, its
   * own: it never takes them from the ray it is cast for. A shadow ray that meets nothing has no hit to
   * stop it and walks its whole segment, the only kind that does. One that spends them has not finished:
   * it counts as lit, where only a cut of one placement that ran out of stack counts as a blocker.
   * A probe's ray therefore costs at most `probeRayWork` plus one `shadowRayWork` for each shadow-casting
   * light that adds light at its first surface (the lighting runs there, once a ray): raising this raises
   * that bound by as many units as the scene has such lights.
   */
  shadowRayWork: 4096,
  shadowRayTriangles: 1024,
} as const

/**
 * The queue of probes one frame traces, first traces included: ray budget ceiling divided by rays
 * per probe, whole probes — the most `probesPerFrame` can be. Plain arithmetic on the two constants,
 * no call nor read of the settings: a bundle that uses no bounce keeps neither this nor
 * `BOUNCE_SETTINGS`.
 */
export const BOUNCE_PROBE_QUEUE =
  (RAYS_PER_FRAME - (RAYS_PER_FRAME % RAYS_PER_PROBE)) / RAYS_PER_PROBE

/**
 * Probe floats layout in GPU storage buffer: 11 × `vec4f`.
 *
 * 9 vectors store spherical harmonics L2 coefficients (constant, 3 linear, 5 quadratic);
 * 2 vectors store 6 directional mean visibility distances. The `w` components store probe state.
 */
export const PROBE_FLOATS = 44

/**
 * The probes a frame traces at most, from the host's `bounceProbesPerFrame`: absent, the default
 * (`BOUNCE_SETTINGS.probesPerFrame`); otherwise a whole count from one to the queue's — anything else
 * is refused, naming what is allowed.
 */
export function resolveProbesPerFrame(asked: number | undefined) {
  if (asked === undefined) return BOUNCE_SETTINGS.probesPerFrame
  if (!Number.isInteger(asked) || asked < 1 || asked > BOUNCE_PROBE_QUEUE)
    throw new RangeError(
      `bounceProbesPerFrame ${asked}: a whole number of probes from 1 to ${BOUNCE_PROBE_QUEUE}`,
    )
  return asked
}
