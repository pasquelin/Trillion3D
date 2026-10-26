/**
 * Indirect bounce lighting: published parameters and bounded limits.
 *
 * The world's probes hold a radiance cache: a map of the light by direction in each, traced through the global
 * distance field and read by the screen probes, which light the pixels. Light requires declared sources: without
 * active lights, indirect irradiance is strictly zero.
 */

/** The most probes one frame queues, first traces included: the static ceiling bounding the compute dispatches over them, and the most `probesPerFrame` can be. */
export const BOUNCE_PROBE_QUEUE = 768

/** Bounce lighting settings. Published operational limits consumed by the runtime engine. */
export const BOUNCE_SETTINGS = {
  /**
   * Levels of probes, each a cube centred on the eye and snapped to its own cells, each cell twice
   * the one before (`cascadeBase`). Beyond the last, the sky light answers.
   */
  cascadeLevels: 4,
  /**
   * Cells along an axis of a level: a level is a cube of `cascadeSize³` cells, and holds a probe in
   * a cell only while the image reads it (`probePool`, `pool/poolWgsl.ts` of the browser engine).
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
   */
  probeKeptMarks: 8,
  /**
   * Pixels along the side of a tile of the image: where the last image cast no screen probe, each tile marks, at every mark, the
   * eight cells around the visible surface point it holds, a point that moves from one mark to the next. Where it cast them, the
   * points they stand on are the ones marked, one a tile of the level that places them.
   */
  markTilePixels: 16,
  /** Marks a view change owes, the jitter of a tile's point taking as many to come round. */
  markJitter: 8,
  /**
   * Probes a frame traces: a count, the refresh's budget, in the cost of a whole map each (a probe past the downsample distance costs a
   * quarter of one, `pool/poolWgsl.ts` of the browser engine). The default is the row of the default level of the screen probes
   * (`radianceProbeBudget` of `SCREEN_PROBE_LEVEL_KNOBS`; each level holds its own, scaled by `screenProbeUpdateSpeed`), what a host that
   * names none gets. A probe never traced comes before every refresh and is never held back, up to the queue (`BOUNCE_PROBE_QUEUE`),
   * and past what the budget has room for at a quarter of a map (`pool/poolWgsl.ts` of the browser engine). The host sets it with
   * `bounceProbesPerFrame`.
   */
  probesPerFrame: 150,
  /** Updates a probe's map takes after a light changed, past which it is left alone and the pass skips encoding. */
  settledTraces: 16,
  /** Surface normal offset bias as fraction of level spacing, where a surface point marks the cells that hold its light. */
  normalBias: 0.35,
  /** Ray reach as fraction of scene bounding diagonal. */
  rayReachFraction: 1,
  /**
   * The furthest a ray looks for a surface, in metres, whatever the scene's size: past it the ray has
   * left the scene, and the sky light answers. A ray is cut at this distance. 200 m by default.
   */
  rayReachMetres: 200,
} as const

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
