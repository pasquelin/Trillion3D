import { MOVE_PROMOTED } from '../../../placement/update.ts'
import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts'
import { boxEquals } from '../../../../../math/src/geometry/box.ts'
import { moveRootRows } from './movedRoot.ts'
import { declareOwnMove, forgetOwnMoves, noteOwnMove, ownsMove } from './movedClusters.ts'
import { appendRootsUnder } from './movedNode.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { transformRootBoxes } from '../../../page/selection/batchBoxes.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * What the nodes of one move call leave to do, done once for the call: the moved
 * roots' boxes reprojected in one pass, their rows alone rewritten (`movedRoot.ts`), the scene
 * revision bumped once, then each node's motion box declared to the shadow scheduler as its own
 * call would — two nodes far apart are two boxes, never the room between them —, save the roots
 * that declare their own, cluster by cluster (`movedClusters.ts`). A root under two moved nodes
 * is passed once, at the pose it ends at. What a root does here depends on it alone (rows marked
 * in a bitmap, its own mobility and box), so the roots are passed in any order.
 *
 * No allocation per call: every list is filled up to a count and never truncated — a truncated
 * array drops its storage — so it grows only for a call larger than any before it.
 */

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
/** Each moved node's box before its move, `BOX_VALUES` each: its roots not declaring their own
 *  (the shadows'). Per root: 1 once it is listed in `distinct`; 1 when its move in this call was
 *  its first. */
let movedBoxes = new Float64Array(BOX_VALUES),
  listedRoots = new Uint8Array(0),
  promotedRoots = new Uint8Array(0)
/** Below one moved root in this many, the moved boxes are transformed one by one rather than as
 *  the lot, which transforms every root: the same `boxTransform` yields the same bits. */
const LOT_SHARE = 8

/**
 * The nodes `nodes` were written — an engine move's, the host's the scene watch heard —, before
 * the transform tree's pass takes them: the roots whose mesh lies in each one's subtree, walked
 * once in the tree (`appendRootsUnder`), and their box before the move. The work follows the
 * nodes written, never the scene's roots.
 */
export function noteMoved(rt: WebgpuPagesRuntime, nodes: Iterable<Object3D>) {
  for (const node of nodes) noteNode(rt, node)
}

/** `noteMoved` for one node. */
export function noteNode(rt: WebgpuPagesRuntime, node: Object3D) {
  const from = movedCount,
    roots = rt.layout.selectionRoots
  movedCount = appendRootsUnder(roots, node, movedList, from)
  noteBefore(rt, from)
}

/** The roots a node moved, `movedList[from .. movedCount)`: their box before the move, kept for
 *  the node's turn (`declareMove`). */
function noteBefore(rt: WebgpuPagesRuntime, from: number) {
  const roots = rt.layout.selectionRoots
  boxEmpty(before, 0)
  for (let j = from; j < movedCount; j++) {
    const box = roots[movedList[j]].worldBox
    if (box && !noteOwnMove(rt, movedList[j])) boxUnionBatch(before, box, 1)
  }
  const at = nodeCount * BOX_VALUES
  movedBoxes = resized(movedBoxes, at + BOX_VALUES)
  movedBoxes.set(before, at)
  movedEnds[nodeCount++] = movedCount
}

/** The pass over the roots the noted nodes moved, then each node's motion box; nothing if none.
 *  The counts are reset even when the pass throws: a later call never inherits stale ranks.
 *  `announce`: an engine move bumps the scene revision itself; a host write's already did. */
export function finishMoves(rt: WebgpuPagesRuntime, announce = true) {
  if (!nodeCount) return
  try {
    passMoves(rt, announce)
  } finally {
    for (let k = 0; k < distinctCount; k++) listedRoots[distinct[k]] = 0
    forgetOwnMoves()
    movedCount = nodeCount = distinctCount = 0
  }
}

/** A node's box before its move (`before`) and after it (`after`), each declared to the shadow
 *  scheduler on its own: a caster stales the pages it left and those it lands in, never the ones
 *  between them. */
function declareMove(rt: WebgpuPagesRuntime, promoted: boolean) {
  const { changes } = rt.lights
  const still = boxEquals(before, 0, after, 0)
  if (!boxIsEmpty(before, 0)) changes.worldChanged(beforeMin, beforeMax, !promoted)
  if (!boxIsEmpty(after, 0) && !still) changes.worldChanged(afterMin, afterMax, !promoted)
}

function passMoves(rt: WebgpuPagesRuntime, announce: boolean) {
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
    moveRootRows(rt, root, i)
    if (!root.worldBox) continue
    // A node moved: each root under it moved, at the pose it now reads.
    promotedRoots[i] = lights.mobility.move(i, root.world.elements, true) === MOVE_PROMOTED ? 1 : 0
    if (root.localBox && !enLot)
      boxTransform(root.worldBox, 0, root.localBox, 0, root.world.elements)
  }
  // Origin of the scene change: these subtrees' world matrices have just been rewritten. Only
  // poses moved — no node entered or left the scene — so the watched set is left as it stands
  // instead of being rebuilt from a walk of the source graph on the next image; the hierarchy
  // already carries this revision's matrices: the next image does not climb it.
  if (announce) {
    run.gate.movedInPlace()
    run.gate.noteWorldsUpdated()
  }
  let start = 0
  for (let k = 0; k < nodeCount; k++) {
    for (let v = 0, a = k * BOX_VALUES; v < BOX_VALUES; v++) before[v] = movedBoxes[a + v]
    boxEmpty(after, 0)
    let promoted = false
    for (let j = start; j < movedEnds[k]; j++) {
      const rank = movedList[j],
        root = roots[rank]
      if (!root.worldBox) continue
      // A root whose change is its own declares it here, in its node's turn, once in the call.
      if (ownsMove(rank)) declareOwnMove(rt, rank, promotedRoots[rank] === 1)
      else promoted = promotedRoots[rank] === 1 || promoted
      if (root.localBox && !ownsMove(rank)) boxUnionBatch(after, root.worldBox, 1)
    }
    start = movedEnds[k]
    declareMove(rt, promoted)
  }
}
