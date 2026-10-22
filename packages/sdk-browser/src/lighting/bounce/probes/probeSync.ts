/** The placements a change touched, as runs of rows: `count` `[first, last]` pairs. */
type MovedRows = {
  /** How many runs `pairs` holds. */
  readonly count: number
  /** The runs, `[first, last]` row pairs, first-inclusive and last-inclusive. */
  readonly pairs: ArrayLike<number>
}

/** The placements' world boxes as the proxy keeps them (`geometry/dag/proxy/proxyInstances.ts`): six world bounds a
 *  placement (an empty box for one that wears no proxy), the runs of those that moved since the last call,
 *  the extent of every box — three lower bounds then three upper, zeros without a box —, and what the
 *  placements that wear a proxy hold: their count and the triangles of the meshes they wear, one count each. */
export type ProxyBoxes = {
  boxes: Float64Array
  moved: MovedRows
  extent: readonly number[]
  worn: { placements: number; triangles: number }
}

/** No placement wears a proxy: no box. */
export const NO_PROXY_BOXES: ProxyBoxes = {
  boxes: new Float64Array(0),
  moved: { count: 0, pairs: new Int32Array(0) },
  extent: [0, 0, 0, 0, 0, 0],
  worn: { placements: 0, triangles: 0 },
}

/** What a sync of the probes with the proxy's placements touches. */
type ProbeSyncParts = {
  boxes(): ProxyBoxes
  cascades: { replan(bounds: readonly number[]): boolean }
  /** The bounce series starts over: the light the probes hold is not the scene's now. */
  restart(): void
}

/**
 * Motion places the world light grid and the rays' reach on the placements' new extent and restarts
 * the series: the probes hold the light of a scene that was. Nothing moved, nothing is touched.
 * Whether anything did.
 */
function syncBounceProbes(parts: ProbeSyncParts) {
  const { moved, extent } = parts.boxes()
  if (!moved.count) return false
  parts.cascades.replan(extent)
  parts.restart()
  return true
}

/**
 * The follow of the probes after the proxy's placements (`syncBounceProbes`), remembering the boxes it read
 * last: `boxes` is what the proxy held at that sync — the placements that wear a proxy and their triangles,
 * their extent.
 */
export function createProxyFollow(parts: ProbeSyncParts) {
  let seen = NO_PROXY_BOXES
  const read = { ...parts, boxes: () => (seen = parts.boxes()) }
  return {
    sync: () => syncBounceProbes(read),
    get boxes() {
      return seen
    },
  }
}
