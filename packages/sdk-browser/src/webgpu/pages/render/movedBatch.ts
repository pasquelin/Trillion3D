import { MOVE_PROMOTED } from '../../../placement/update.ts'
import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts'
import { boxEquals } from '../../../../../sdk-core/src/math/primitives/box.ts'
import { moveRootRows } from './movedRoot.ts'
import { declareOwnMove, forgetOwnMoves, noteOwnMove, ownsMove } from './movedClusters.ts'
import { staleTemporalBox } from '../../../hiz/staleRegions.ts'
import { appendRootsUnder } from './movedNode.ts'
import { transformRootBoxes } from '../../../math/batchBoxes.ts'
import { grown } from '../../../../../sdk-core/src/math/transform-tree/storage.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'

/**
 * What the nodes of one move call leave to do, done once for the call (#971, CPU-19): the moved
 * roots' boxes reprojected in one pass, their rows alone rewritten (`movedRoot.ts`), the scene
 * revision bumped once, then each node's motion box declared to the shadow scheduler as its own
 * call would — two nodes far apart are two boxes, never the room between them —, save the roots
 * that declare their own, cluster by cluster (`movedClusters.ts`). The Hi-Z takes the node's box
 * whole. A root under two moved nodes is passed once, at the pose it ends at. What a root does
 * here depends on it alone (rows marked in a bitmap, its own mobility and box), so the roots are
 * passed in any order.
 *
 * No allocation per call: every list is filled up to a count and never truncated — a truncated
 * array drops its storage — so it grows only for a call larger than any before it.
 */

const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6)
/** A moved node's box before its move and after it (`declareMove`), its own roots left out. */
const before = new Float64Array(BOX_VALUES),
  beforeMin = before.subarray(0, 3),
  beforeMax = before.subarray(3, 6),
  after = new Float64Array(BOX_VALUES),
  afterMin = after.subarray(0, 3),
  afterMax = after.subarray(3, 6)
/** Ranks of the roots under each moved node, node after node; where each node's ranks end; the
 *  distinct ranks of several nodes. */
const movedList: number[] = [],
  movedEnds: number[] = [],
  distinct: number[] = []
let movedCount = 0,
  nodeCount = 0,
  distinctCount = 0
/** Each moved node's boxes before its move, `BOX_VALUES` each: every root's (the Hi-Z's), then
 *  those not declaring their own (the shadows'). Per root: 1 once it is listed in `distinct`; 1
 *  when its move in this call was its first. */
let movedBoxes = new Float64Array(2 * BOX_VALUES),
  listedRoots = new Uint8Array(0),
  promotedRoots = new Uint8Array(0)
/** Below one moved root in this many, the moved boxes are transformed one by one rather than as
 *  the lot, which transforms every root: the same `boxTransform` yields the same bits. */
const LOT_SHARE = 8

/** `node` was just posed: the roots whose mesh lies in its subtree — walked once — and their box
 *  before the move. */
export function noteMoved(rt: WebgpuPagesRuntime, node: Object3D) {
  const roots = rt.layout.selectionRoots
  const from = movedCount
  movedCount = appendRootsUnder(roots, node, movedList, from)
  boxEmpty(moved, 0)
  boxEmpty(before, 0)
  for (let j = from; j < movedCount; j++) {
    const box = roots[movedList[j]].worldBox
    if (!box) continue
    boxUnionBatch(moved, box, 1)
    if (!noteOwnMove(rt, movedList[j])) boxUnionBatch(before, box, 1)
  }
  const at = nodeCount * 2 * BOX_VALUES
  if (at + 2 * BOX_VALUES > movedBoxes.length)
    movedBoxes = grown(movedBoxes, Float64Array, movedBoxes.length * 2)
  movedBoxes.set(moved, at)
  movedBoxes.set(before, at + BOX_VALUES)
  movedEnds[nodeCount++] = movedCount
}

/** The pass over the roots the noted nodes moved, then each node's motion box; nothing if none.
 *  The counts are reset even when the pass throws: a later call never inherits stale ranks. */
export function finishMoves(rt: WebgpuPagesRuntime) {
  if (!nodeCount) return
  try {
    passMoves(rt)
  } finally {
    for (let k = 0; k < distinctCount; k++) listedRoots[distinct[k]] = 0
    forgetOwnMoves()
    movedCount = nodeCount = distinctCount = 0
  }
}

/** A node's box before its move (`before`) and after it (`after`), each declared to the shadow
 *  scheduler on its own: a caster stales the pages it left and those it lands in, never the ones
 *  between them. The Hi-Z takes the union of every root's, `moved`. */
function declareMove(rt: WebgpuPagesRuntime, promoted: boolean) {
  if (boxIsEmpty(moved, 0)) return
  const { changes } = rt.lights
  const still = boxEquals(before, 0, after, 0)
  if (!boxIsEmpty(before, 0)) changes.worldChanged(beforeMin, beforeMax, !promoted)
  if (!boxIsEmpty(after, 0) && !still) changes.worldChanged(afterMin, afterMax, !promoted)
  staleTemporalBox(rt.run.temporalHizState, movedMin, movedMax)
}

function passMoves(rt: WebgpuPagesRuntime) {
  const { lights, run, layout } = rt,
    roots = layout.selectionRoots
  if (promotedRoots.length < roots.length) {
    promotedRoots = new Uint8Array(roots.length)
    listedRoots = new Uint8Array(roots.length)
  }
  // One node's ranks are already distinct (`appendRootsUnder`); several nodes' may overlap.
  let ranks = movedList,
    count = movedCount
  if (nodeCount > 1) {
    for (let j = 0; j < movedCount; j++) {
      const i = movedList[j]
      if (listedRoots[i]) continue
      listedRoots[i] = 1
      distinct[distinctCount++] = i
    }
    ranks = distinct
    count = distinctCount
  }
  // World boxes of the moved roots reproject IN BATCH, through the governor, in the buffer
  // reserved at prepare. A missing or released buffer hands over to the box-by-box computation,
  // which yields the same bits — the same `boxTransform` on the same inputs.
  const lot = count * LOT_SHARE >= roots.length ? layout.rootBoxes : null
  const enLot = !!lot && transformRootBoxes(lot, roots, ranks, count)
  for (let k = 0; k < count; k++) {
    const i = ranks[k],
      root = roots[i]
    moveRootRows(rt, root)
    if (!root.worldBox) continue
    // A node moved: each root under it moved, at the pose it now reads.
    promotedRoots[i] = lights.mobility.move(i, root.world.elements, true) === MOVE_PROMOTED ? 1 : 0
    if (root.localBox && !enLot)
      boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements)
  }
  // Origin of the scene change: these subtrees' world matrices have just been rewritten. Only
  // poses moved — no node entered or left the scene — so the watched set is left as it stands
  // instead of being rebuilt from a walk of the source graph on the next image.
  run.gate.sceneMoved()
  // The hierarchy already carries this revision's matrices: the next image does not climb it.
  run.gate.noteWorldsUpdated()
  let start = 0
  for (let k = 0; k < nodeCount; k++) {
    for (let v = 0, a = 2 * k * BOX_VALUES; v < BOX_VALUES; v++) {
      moved[v] = movedBoxes[a + v]
      before[v] = movedBoxes[a + BOX_VALUES + v]
    }
    boxEmpty(after, 0)
    let promoted = false
    for (let j = start; j < movedEnds[k]; j++) {
      const rank = movedList[j],
        root = roots[rank]
      if (!root.worldBox) continue
      // A root whose change is its own declares it here, in its node's turn, once in the call.
      if (ownsMove(rank)) declareOwnMove(rt, rank, promotedRoots[rank] === 1)
      else promoted = promotedRoots[rank] === 1 || promoted
      if (!root.localBox) continue
      boxUnionBatch(moved, root.worldBox, 1)
      if (!ownsMove(rank)) boxUnionBatch(after, root.worldBox, 1)
    }
    start = movedEnds[k]
    declareMove(rt, promoted)
  }
}
