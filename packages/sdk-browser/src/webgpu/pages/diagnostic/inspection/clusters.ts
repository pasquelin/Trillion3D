import { NO_INDEX } from '../../../../../../math/src/constants.ts'
import { boxFromPoints } from '../../../../../../math/src/geometry/box.ts'
import { BOX_CORNER_VALUES } from '../../../../hiz/corners.ts'
import { VERDICT_REJECTED } from '../../../../gpu/partition/contract.ts'
import { PAGE_INFO } from '../../../../visibility/pageInfo.ts'
import { ROW_WORDS } from '../../../../visibility/types.ts'
import type { PageRec } from '../../../../page/selection/types.ts'
import { packedPageCornersInto } from '../../../core/partitionAudit.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { CLUSTER_STATE, INSPECTION_CLUSTER_CAP, type InspectedClusters } from './types.ts'

/**
 * The main view's cut as its image left it, taken on the CPU at the image (`snapshotClusters`):
 * the drawn instances first, then those the cut asked for that are not resident; each one's world
 * corners, level, triangles and Hi-Z slot (`-1` where the occlusion test never judges it — a
 * blended, sprite or deformed cluster —, the verdict read back for the others).
 */
export type ClusterSnapshot = {
  count: number
  corners: Float64Array
  level: Uint8Array
  triangles: Uint32Array
  slots: Int32Array
  /** Entries from this rank on are asked and not resident. */
  firstMissing: number
  frustumRejected: number
  truncated: boolean
}

/** The Hi-Z slot of packed page `packed`'s row, `-1` where none judges it
 *  (`../../../row/pageRowWriter.ts`, `hizSlot`). */
function hizSlotOf(rt: WebgpuPagesRuntime, packed: number) {
  const { rows } = rt.layout,
    ints = rows.pageTableInts,
    row = rows.rowOf(packed)
  if (!ints || row < 0) return -1
  const slot = ints[row * ROW_WORDS + PAGE_INFO.at.hizSlot]
  return slot === NO_INDEX ? -1 : slot
}

/** `snap`'s entry `at`: packed page `packed` of record `rec`, judged at `slot`. */
function take(
  rt: WebgpuPagesRuntime,
  snap: ClusterSnapshot,
  rec: PageRec,
  packed: number,
  slot: number,
) {
  const at = snap.count++
  packedPageCornersInto(rt.layout, snap.corners, at * BOX_CORNER_VALUES, packed, rec)
  snap.level[at] = rec.level ?? 0
  snap.triangles[at] = rec.triangles
  snap.slots[at] = slot
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
    slots: new Int32Array(capacity),
    firstMissing: 0,
    frustumRejected: rt.run.frustumRejected,
    truncated: wanted > capacity,
  }
  for (let i = 0; i < drawn.length && snap.count < capacity; i++) {
    const rec = drawn[i]
    take(rt, snap, rec, drawnPacked[i], rec.transparent ? -1 : hizSlotOf(rt, drawnPacked[i]))
  }
  snap.firstMissing = snap.count
  for (let i = 0; i < desired.length && snap.count < capacity; i++)
    if (!drawnRanks.has(desiredPacked[i])) take(rt, snap, desired[i], desiredPacked[i], -1)
  return snap
}

/** The slots `snap` reads a verdict at, past the last of which nothing is read back. */
export function slotsRead(snap: ClusterSnapshot) {
  let last = -1
  for (let i = 0; i < snap.count; i++) last = Math.max(last, snap.slots[i])
  return last + 1
}

/** The world boxes of `snap`'s entries — the least and greatest of each one's eight corners — and
 *  their states, `verdicts` the Hi-Z flags read back (`hizFlags`, a word a slot). */
export function inspectedClusters(
  snap: ClusterSnapshot,
  verdicts?: Uint32Array,
): InspectedClusters {
  const { count, corners, slots } = snap
  const bounds = new Float32Array(count * 6),
    box = new Float64Array(6),
    state = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    boxFromPoints(box, 0, corners, i * BOX_CORNER_VALUES, 8)
    bounds.set(box, i * 6)
    const slot = slots[i]
    state[i] =
      i >= snap.firstMissing
        ? CLUSTER_STATE.missing
        : slot >= 0 && verdicts?.[slot] === VERDICT_REJECTED
          ? CLUSTER_STATE.occluded
          : CLUSTER_STATE.kept
  }
  return {
    count,
    bounds,
    level: snap.level.slice(0, count),
    state,
    triangles: snap.triangles.slice(0, count),
    frustumRejected: snap.frustumRejected,
    truncated: snap.truncated,
  }
}
