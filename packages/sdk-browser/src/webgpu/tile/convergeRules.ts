/** Convergence turns at most: beyond that, what is missing is published, never waited for forever. */
const CONVERGE_LIMIT = 64

/** Images a convergence draws at most over the still image's `phases`: the turns, then room for
 *  a whole quiet round closing on the replayed phase (`texturesConverged`) after the last tile
 *  served — at a low render scale a round outnumbers the turns. */
export const convergeBound = (phases: number) => CONVERGE_LIMIT + 2 * phases

/** True when the barrier changed the raster: TAA must restart its still average. */
export const mustRestartTaaAfterSettle = (tilesServed: number, shadowFrames: number) =>
  tilesServed > 0 || shadowFrames > 0

/** Images in a row that hear every pixel's missing picks: a convergence image asks them on every
 *  other row, the rows swapping each image (`feedbackMissing`, `requestWgsl.ts`). */
const ROWS_HEARD = 2

/**
 * True once a convergence may stop: a whole round of the still image's `phases` jitter phases in a
 * row asked for nothing new — two images at least, so that every row asked (`ROWS_HEARD`), at a
 * barrier that takes no picture or without temporal accumulation —, ending on the replayed phase —
 * image `image + 1` is a multiple of `phases`, so the last image drawn is the one the next image
 * follows —, and nothing is waited for that will come.
 */
export const texturesConverged = (
  quiet: number,
  phases: number,
  image: number,
  pending: number,
  reading: boolean,
) => quiet >= Math.max(phases, ROWS_HEARD) && (image + 1) % phases === 0 && (!pending || !reading)

/** True while the drain draws one more image: a page made or unmade resident after the last image
 *  (`seen`, `now`: the pool's residency revision), which no shadow map saw yet — the pages it
 *  stales are drawn again before the still average, not during it; or shadows unsettled. */
export const drainsAgain = (seen: unknown, now: unknown, unsettled: () => boolean) =>
  seen !== now || unsettled()
