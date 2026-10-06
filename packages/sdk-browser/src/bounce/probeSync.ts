import type { ProxySync } from '../../../sdk-core/src/scene/core/proxyMotion.ts'

type WorldOf = (source: number) => ArrayLike<number> | undefined

/** What a proxy sync touches on the probe side. */
export type ProbeSyncParts = {
  resident: {
    sync(worldOf: WorldOf): ProxySync
    bounds: readonly number[]
    triangleBoxes: ArrayLike<number>
    changedTriangles: ArrayLike<number>
  }
  cascades: { replan(bounds: readonly number[]): boolean; invalidLevels: number }
  occupancy: { moved(boxes: ArrayLike<number>, changed: ArrayLike<number>): void }
  /** Levels whose probes the cascades dropped, cleared at the next encode. */
  invalidate(levels: number): void
  /** The bounce series starts over: probe sweeps and surface sweeps. */
  restart(): void
}

/**
 * Motion replans the cascades, marks the moved triangles' cells and restarts the series. A settle
 * does none of that: it writes triangles at the pose they were already traced at, and the surface
 * pass already evaluated them there (`surfaceWgsl.ts`), so it only uploads them and their flags.
 */
export function syncBounceProbes(parts: ProbeSyncParts, worldOf: WorldOf): ProxySync {
  const { resident, cascades } = parts
  const change = resident.sync(worldOf)
  if (change !== 'moved') return change
  if (cascades.replan(resident.bounds)) parts.invalidate(cascades.invalidLevels)
  parts.occupancy.moved(resident.triangleBoxes, resident.changedTriangles)
  parts.restart()
  return change
}
