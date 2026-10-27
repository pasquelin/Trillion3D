/**
 * Indirect bounce lighting: published parameters and bounded limits.
 *
 * The world's probes hold a radiance cache: a map of the light by direction in each, traced through the global
 * distance field and read by the screen probes, which light the pixels.
 */

import { ceilDiv, nextPow2 } from '../../../math/src/scalar/integers.ts'

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
} as const

/** What a cache of probes is shaped by: the levels, their cells, the first level's reach and the pool of probes. `BOUNCE_SETTINGS` is the
 *  shape of the world's probes; a cache of its own shapes itself by its own values (`translucencyGiRadianceCache*`). */
export interface BounceShape {
  readonly cascadeLevels: number
  readonly cascadeSize: number
  readonly cascadeHalfExtentMetres: number
  readonly cascadeBase: number
  readonly probePool: number
}

/** The most levels a cache holds: what the declared uniform of the levels has room for. */
export const BOUNCE_MAX_LEVELS = 6

/** The most probes along a side of the atlas a pool is asked for. */
const MAX_ATLAS_PROBES = 1024

/** The width of a row of the atlas of a pool of `probes`: the power of two over the side of its square, so that a probe's row is a shift. */
export const probeRowOf = (probes: number) => nextPow2(Math.ceil(Math.sqrt(probes)))

/**
 * The probes of a pool asked for `requested` probes along a side of its atlas, held to 1 to 1024: a row the next power of two over it wide,
 * as many rows as hold the square of it.
 */
export function probePoolOf(requested: number) {
  const side = Math.min(Math.max(Math.trunc(requested), 1), MAX_ATLAS_PROBES)
  const width = nextPow2(side)
  return width * ceilDiv(side * side, width)
}

/**
 * The probes one frame queues, first traces included, for a frame budget of `budget` whole maps: the pool over `atlasDownsample` (the factor
 * the temporary atlas their maps are traced into is divided by, `screenProbeRadianceCacheTemporaryAtlasDownsampleFactor`), or four times the
 * budget — the probes it names where every one is traced at a quarter of a map —, the greater, laid as a block of probes whose rows are a
 * power of two wide, no wider than a row of the pool (`probeRowOf`), so never more than the pool of `pool` probes (the world's, by default).
 * `row` is the probes along a row of that block and `probes` their count.
 */
export function probeQueueShapeFor(
  budget: number,
  atlasDownsample: number,
  pool: number = BOUNCE_SETTINGS.probePool,
) {
  const wanted = Math.max(ceilDiv(pool, atlasDownsample), 4 * budget)
  const side = Math.floor(Math.sqrt(wanted))
  // Never more than the pool's own rows of probes hold.
  const poolRow = probeRowOf(pool)
  const row = Math.min(nextPow2(side), poolRow)
  return { row, probes: row * Math.min(ceilDiv(side * side, row), ceilDiv(pool, poolRow)) }
}

/** The probes one frame queues (`probeQueueShapeFor`). */
export const probeQueueFor = (budget: number, atlasDownsample: number, pool?: number) =>
  probeQueueShapeFor(budget, atlasDownsample, pool).probes

/** The block of probes a frame's queue is laid in: the whole pool, in the rows of its own atlas, in a full update (every probe given back and
 *  traced); else what the frame's budget names (`probeQueueShapeFor`). */
export const probeQueueShapeOf = (
  budget: number,
  atlasDownsample: number,
  full: boolean,
  pool: number = BOUNCE_SETTINGS.probePool,
) =>
  full ? { row: probeRowOf(pool), probes: pool } : probeQueueShapeFor(budget, atlasDownsample, pool)
