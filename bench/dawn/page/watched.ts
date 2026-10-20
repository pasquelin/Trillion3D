// The engine counters that say a pass has nothing to do, read on every frame of a segment so a pass
// is called wasted only when its counter was seen and was zero on all of them.

/** By pass name: the counter's key and what a zero of it says. The counter must cover the pass: the
 *  blend pass draws the blended meshes `transparentMeshes` counts, no more. */
export const IDLE_COUNTERS: Record<string, [key: string, what: string]> = {
  transparents: ['transparentMeshes', 'no transparent mesh'],
}

/** The keys read each frame. */
export const WATCHED = Object.values(IDLE_COUNTERS).map(([key]) => key)

/** The watched counters of one frame's metrics, the numbers among them. */
export function watchedOf(metrics: Record<string, unknown> | null | undefined) {
  const out: Record<string, number> = {}
  for (const key of WATCHED) {
    const value = metrics?.[key]
    if (typeof value === 'number') out[key] = value
  }
  return out
}
