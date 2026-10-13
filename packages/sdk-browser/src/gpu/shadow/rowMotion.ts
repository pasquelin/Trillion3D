/**
 * WHAT CHANGED IN THE CASTER ROWS' SPHERES SINCE A FRAME, as the shadow raster's chunk bound reads
 * it (`../../vsm/rowPageBound.ts`): two running sums the CPU keeps once a frame, before the rows go
 * up (`../../webgpu/shadow/rowTravel.ts`), and a histogram of the spheres (`../../vsm/rowBinsGpu.ts`)
 * notes beside it when it is made. Between that frame and this one:
 *
 * - `derived` − its `derived`: at most that many rows hold another sphere for a reason other than a
 *   moving placement's travel — a row written, a whole table, a placement that started moving or
 *   was linked or let go. Each may reach every page.
 * - `travel` − its `travel`: no row of a placement moving then lies farther than that from the
 *   sphere it was binned at: its sphere now holds within that sphere grown by it.
 *
 * `past` holds `travel` at the last `PAST` commits: how far the placements went over the last frames,
 * the margin a new histogram's moving rows are binned at.
 */
const PAST = 8

export function createRowMotion() {
  return { derived: 0, travel: 0, commits: 0, past: new Float64Array(PAST) }
}
export type RowMotion = ReturnType<typeof createRowMotion>

/** One frame's commit: `rows` rows derived, and the farthest a moving placement's row went. */
export function commitMotion(motion: RowMotion, rows: number, farthest: number) {
  motion.derived += rows
  motion.travel += farthest
  motion.past[motion.commits % PAST] = motion.travel
  motion.commits++
}

/** How far the moving placements went over the last `frames` commits (fewer than `PAST`): the
 *  whole travel while fewer were made. */
export function recentTravel(motion: RowMotion, frames: number) {
  const back = Math.min(frames, PAST - 1)
  if (motion.commits <= back) return motion.travel
  return motion.travel - motion.past[(motion.commits - 1 - back) % PAST]
}
