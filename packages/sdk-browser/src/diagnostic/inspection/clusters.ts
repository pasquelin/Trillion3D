import { boxFromPoints } from '../../../../math/src/geometry/box.ts'
import { BOX_CORNER_VALUES } from '../../visibility/hiz/corners.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import { packedPageCornersInto } from '../../blend/transparent/occlusionAudit.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { CLUSTER_STATE, INSPECTION_CLUSTER_CAP, type InspectedClusters } from './types.ts'

/**
 * The main view's cut as its image left it, taken on the CPU at the image (`snapshotClusters`):
 * the drawn instances first — the pages its frame mask drew, both passes —, then those the cut
 * asked for that are not drawn; each one's world corners, level and triangles. The cut's
 * occlusion gives counts, not clusters: it judges items of the placement tree and the DAG before
 * any cluster is listed (`InspectedClusters.occluded`, `postHidden`).
 */
export type ClusterSnapshot = {
  count: number
  corners: Float64Array
  level: Uint8Array
  triangles: Uint32Array
  /** Entries from this rank on are asked and not drawn. */
  firstMissing: number
  frustumRejected: number
  occluded: number
  postHidden: number
  truncated: boolean
}

/** `snap`'s entry `at`: packed page `packed` of record `rec`. */
function take(rt: WebgpuPagesRuntime, snap: ClusterSnapshot, rec: PageRec, packed: number) {
  const at = snap.count++
  packedPageCornersInto(rt.layout, snap.corners, at * BOX_CORNER_VALUES, packed, rec)
  snap.level[at] = rec.level ?? 0
  snap.triangles[at] = rec.triangles
}

/** The main view's drawn and missing instances, at most `INSPECTION_CLUSTER_CAP`: copied now, so
 *  the next image's adoption rewrites none of it. */
export function snapshotClusters(rt: WebgpuPagesRuntime): ClusterSnapshot {
  const { drawn, drawnPacked, desired, desiredPacked } = rt.run
  const drawnRanks = new Set(drawnPacked)
  let missing = 0
  for (const packed of desiredPacked) if (!drawnRanks.has(packed)) missing++
  const wanted = drawn.length + missing,
    capacity = Math.min(wanted, INSPECTION_CLUSTER_CAP)
  const snap: ClusterSnapshot = {
    count: 0,
    corners: new Float64Array(capacity * BOX_CORNER_VALUES),
    level: new Uint8Array(capacity),
    triangles: new Uint32Array(capacity),
    firstMissing: 0,
    frustumRejected: rt.run.frustumRejected,
    occluded: rt.run.occluded,
    postHidden: rt.run.postHidden,
    truncated: wanted > capacity,
  }
  for (let i = 0; i < drawn.length && snap.count < capacity; i++)
    take(rt, snap, drawn[i], drawnPacked[i])
  snap.firstMissing = snap.count
  for (let i = 0; i < desired.length && snap.count < capacity; i++)
    if (!drawnRanks.has(desiredPacked[i])) take(rt, snap, desired[i], desiredPacked[i])
  return snap
}

/** The world boxes of `snap`'s entries — the least and greatest of each one's eight corners — and
 *  their states: drawn, or asked and not drawn. */
export function inspectedClusters(snap: ClusterSnapshot): InspectedClusters {
  const { count, corners } = snap
  const bounds = new Float32Array(count * 6),
    box = new Float64Array(6),
    state = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    boxFromPoints(box, 0, corners, i * BOX_CORNER_VALUES, 8)
    bounds.set(box, i * 6)
    state[i] = i >= snap.firstMissing ? CLUSTER_STATE.missing : CLUSTER_STATE.kept
  }
  return {
    count,
    bounds,
    level: snap.level.slice(0, count),
    state,
    triangles: snap.triangles.slice(0, count),
    frustumRejected: snap.frustumRejected,
    occluded: snap.occluded,
    postHidden: snap.postHidden,
    truncated: snap.truncated,
  }
}
