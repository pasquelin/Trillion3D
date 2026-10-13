import type { MovedRows } from '../../../sdk-core/src/index.ts'

/** The placements' world boxes as the proxy keeps them (`gpu/dag/proxyInstances.ts`): six world bounds a
 *  placement (an empty box for one that wears no proxy), the runs of those that moved since the last call,
 *  and the extent of every box — three lower bounds then three upper, zeros without a box. */
export type ProxyBoxes = { boxes: Float64Array; moved: MovedRows; extent: readonly number[] }

/** No placement wears a proxy: no box. */
export const NO_PROXY_BOXES: ProxyBoxes = {
  boxes: new Float64Array(0),
  moved: { count: 0, pairs: new Int32Array(0) },
  extent: [0, 0, 0, 0, 0, 0],
}

/** What a sync of the probes with the proxy's placements touches. */
export type ProbeSyncParts = {
  boxes(): ProxyBoxes
  cascades: { replan(bounds: readonly number[]): boolean; invalidLevels: number }
  occupancy: { moved(boxes: ArrayLike<number>, rows: MovedRows): void }
  /** Levels whose probes the cascades dropped, cleared at the next encode. */
  invalidate(levels: number): void
  /** The bounce series starts over: probe sweeps. */
  restart(): void
}

/**
 * Motion replans the cascades over the placements' new extent, marks the cells of the boxes that moved or
 * arrived and restarts the series. Nothing moved, nothing is touched. Returns the boxes and their extent
 * when something did. The work follows the boxes that moved: the proxy keeps the others and the extent.
 */
export function syncBounceProbes(parts: ProbeSyncParts) {
  const { boxes, moved, extent } = parts.boxes()
  if (!moved.count) return undefined
  if (parts.cascades.replan(extent)) parts.invalidate(parts.cascades.invalidLevels)
  parts.occupancy.moved(boxes, moved)
  parts.restart()
  return { boxes, extent }
}
