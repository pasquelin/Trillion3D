import { MOVE_PROMOTED } from '../../../placement/update.ts'
import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnionBatch,
} from '../../../../../sdk-core/src/index.ts'
import { boxGrow } from '../../../../../math/src/geometry/box.ts'
import { markReach } from '../../../deformation/halfFloat.ts'
import { markRootRows } from './movedRoot.ts'
import type { ClusterRoot, MovedBox, PageRec } from '../../../page/selection/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * Geometry that moves in place — rewritten vertices, a GPU deformation —, declared as a node's
 * move (`movedBatch.ts`): one world box to the shadow scheduler, its pages whole on
 * the first move of what it holds.
 */

const moved = new Float64Array(BOX_VALUES),
  movedMin = moved.subarray(0, 3),
  movedMax = moved.subarray(3, 6)

/** Root `rank` moved: whether it was its first move, the static shadow layer's to leave it out. */
const promote = (rt: WebgpuPagesRuntime, rank: number) =>
  rt.lights.mobility.move(rank, rt.layout.selectionRoots[rank].world.elements, true) ===
  MOVE_PROMOTED
/** `moved` declared to the shadow scheduler: a first move stales its pages whole. */
function declare(rt: WebgpuPagesRuntime, promoted: boolean) {
  if (boxIsEmpty(moved, 0)) return
  rt.lights.changes.worldChanged(movedMin, movedMax, !promoted)
}

/** Whether `own` is the box `boxes` holds from `b`. */
function holds(own: MovedBox, boxes: Float64Array, b: number) {
  for (let a = 0; a < 3; a++)
    if (own.min[a] !== boxes[b + a] || own.max[a] !== boxes[b + 3 + a]) return false
  return true
}

const span = { from: 0, to: -1 }
/** Root `root` takes its pages' boxes of `boxes` (`BOX_VALUES` a page, page `k` its `k`-th), and
 *  widens `span` to the pages whose box moved. A record its placements share takes its box once —
 *  every placement's rows then follow the span. */
function takeBoxes(root: ClusterRoot<PageRec>, boxes: Float64Array) {
  for (let k = 0, b = 0; k < root.pages.length; k++, b += BOX_VALUES) {
    const rec = root.pages[k]
    if (rec.moved && holds(rec.moved, boxes, b)) continue
    const own = (rec.moved ??= { min: [0, 0, 0], max: [0, 0, 0] })
    for (let a = 0; a < 3; a++) {
      own.min[a] = boxes[b + a]
      own.max[a] = boxes[b + 3 + a]
    }
    span.from = Math.min(span.from, k)
    span.to = Math.max(span.to, k)
  }
}

/** Root `rank`'s vertices moved: its pages `from` to `to` lie in other boxes, which every
 *  bound of their rows reads (`rowBox`), and its vertices lie up to `reach` from where its pages
 *  are bounded, which every cut — the GPU's by its mark — grows those rest bounds by, as a
 *  deformation's. Only the rows whose bounds changed travel again: without boxes (`boxed` false),
 *  each row grows by the reach, and a new one moves them all. */
function holdMotion(
  rt: WebgpuPagesRuntime,
  rank: number,
  reach: number,
  from: number,
  to: number,
  boxed: boolean,
) {
  const root = rt.layout.selectionRoots[rank]
  if (reach !== (root.reach ?? 0)) {
    root.reach = reach
    rt.run.gpuSelection?.markWorld(rank, markReach(root.mark ?? 0, reach))
    if (!boxed) {
      from = 0
      to = root.pages.length - 1
    }
  }
  markRootRows(rt, root, from, to)
}

const local = new Float64Array(BOX_VALUES),
  /** The ranks of the roots drawing the rewritten attributes, found by the one pass over the roots. */
  drawing: number[] = []
/** A dynamic geometry's rewrite, its moved vertices within `box`, `reach` from where its pages are
 *  bounded and each page's within its box of `boxes` (when given), declared as a node's move: each
 *  root drawing `attributes` moves and holds them, and the world box of `box` stales its shadow
 *  pages. An empty `box` moved nothing: a new session's roots hear the reach and boxes alone. */
export function noteRewritten(
  rt: WebgpuPagesRuntime,
  attributes: object,
  box: Float64Array,
  reach: number,
  boxes?: Float64Array,
) {
  const roots = rt.layout.selectionRoots,
    still = boxIsEmpty(box, 0)
  let promoted = false
  span.from = Infinity
  span.to = -1
  boxEmpty(moved, 0)
  drawing.length = 0
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank]
    if (root.pages[0]?.attributes !== attributes) continue
    drawing.push(rank)
    if (boxes) takeBoxes(root, boxes)
    if (still) continue
    promoted = promote(rt, rank) || promoted
    boxTransform(local, 0, box, 0, root.world.elements)
    boxUnionBatch(moved, local, 1)
  }
  // Every root holds the span of the whole batch: it is known once the pass is done.
  const from = boxes ? span.from : 0,
    to = boxes ? span.to : -1
  for (const rank of drawing) holdMotion(rt, rank, reach, from, to, !!boxes)
  declare(rt, promoted)
}

/** Roots `ranks`, the placements of one record set, hold those pages' boxes of `boxes`
 *  (`BOX_VALUES` a page, page `k` its `k`-th, local): the rows of the pages whose box moved travel
 *  again, every placement's, as a rewrite's (`noteRewritten`) — where the waves carry a sea's pages
 *  (`../../../deformation/wavePages.ts`). */
export function holdPageBoxes(
  rt: WebgpuPagesRuntime,
  ranks: readonly number[],
  boxes: Float64Array,
) {
  const roots = rt.layout.selectionRoots
  span.from = Infinity
  span.to = -1
  takeBoxes(roots[ranks[0]], boxes)
  for (const rank of ranks) markRootRows(rt, roots[rank], span.from, span.to)
}

/** Roots `ranks`' pages bounded by their own boxes grown by the roots' reach again (`rowBox`):
 *  the boxes `holdPageBoxes` gave them dropped, every row of theirs sent again. */
export function releasePageBoxes(rt: WebgpuPagesRuntime, ranks: readonly number[]) {
  const roots = rt.layout.selectionRoots,
    { pages } = roots[ranks[0]]
  for (const rec of pages) rec.moved = undefined
  for (const rank of ranks) markRootRows(rt, roots[rank], 0, pages.length - 1)
}

/** Root `rank`'s GPU deformation moved: it moves, and its rest world box grown by `reach`
 *  world units — the most it reached this frame or the last — stales its shadow pages. */
export function noteDeformed(rt: WebgpuPagesRuntime, rank: number, reach: number) {
  const box = rt.layout.selectionRoots[rank].worldBox
  if (!box) return
  boxGrow(moved, 0, box, 0, reach)
  declare(rt, promote(rt, rank))
}

/** A whole-copy deformation changed only this bounded world region. */
export function noteDeformedBounds(rt: WebgpuPagesRuntime, box: Float64Array) {
  moved.set(box)
  declare(rt, false)
}
