/** What a sync of the probes with the proxy's placements touches. */
export type ProbeSyncParts = {
  /** The world boxes of the placements that wear a proxy, and which are new or moved since the last call
   *  (`gpu/dag/proxyInstances.ts`). */
  boxes(): { boxes: Float64Array; changed: Uint8Array }
  cascades: { replan(bounds: readonly number[]): boolean; invalidLevels: number }
  occupancy: { moved(boxes: ArrayLike<number>, changed: ArrayLike<number>): void }
  /** Levels whose probes the cascades dropped, cleared at the next encode. */
  invalidate(levels: number): void
  /** The bounce series starts over: probe sweeps. */
  restart(): void
}

/** The extent of `boxes` (six numbers each): three lower bounds then three upper; zeros without a box. */
export function boxesExtent(boxes: ArrayLike<number>) {
  const extent = [0, 0, 0, 0, 0, 0]
  for (let at = 0; at + 6 <= boxes.length; at += 6)
    for (let axis = 0; axis < 3; axis++) {
      extent[axis] = at ? Math.min(extent[axis], boxes[at + axis]) : boxes[at + axis]
      extent[3 + axis] = at
        ? Math.max(extent[3 + axis], boxes[at + 3 + axis])
        : boxes[at + 3 + axis]
    }
  return extent
}

/**
 * Motion replans the cascades over the placements' new extent, marks the cells of the boxes that moved or
 * arrived and restarts the series. Nothing moved, nothing is touched. Returns the boxes and their extent
 * when something did.
 */
export function syncBounceProbes(parts: ProbeSyncParts) {
  const { boxes, changed } = parts.boxes()
  if (!changed.some(Boolean)) return undefined
  const extent = boxesExtent(boxes)
  if (parts.cascades.replan(extent)) parts.invalidate(parts.cascades.invalidLevels)
  parts.occupancy.moved(boxes, changed)
  parts.restart()
  return { boxes, extent }
}
