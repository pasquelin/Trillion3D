import { BOX_VALUES, boxTransform, boxUnionBatch } from '../../../../../sdk-core/src/index.ts'
import { boxEquals } from '../../../../../sdk-core/src/math/primitives/box.ts'
import { grown } from '../../../../../sdk-core/src/math/transform-tree/storage.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * A MOVED ROOT'S SHADOW CHANGE, CLUSTER BY CLUSTER. A root's box holds what it draws and
 * all that lies between: a turning ring's holds its hollow, a gear's the air between its teeth.
 * Declared whole, it stales every page under it each frame it turns — the whole astrolabe's pages.
 * A root declares instead the box of each of its clusters (`PageRec.min`, `max`: what the cut and
 * the shadow cull test it by), at its pose before the move and after, one box when the two meet,
 * two apart when not. A page no cluster box covers, at either pose, holds no texel of it: it keeps
 * its depth, and a ring turning in its own plane redraws the pages along the ring alone.
 *
 * Its clusters must be all it can draw: every page a leaf of its primitive (`level` 0, as every run
 * time primitive's, `world/page/runtimePrimitive.ts`) — a coarser cluster stands for a whole region
 * of leaves, its box the hollow's too. A primitive with coarser levels or pages without a box
 * (`boxes`), one whose clusters would take more than a quarter of what the plan's list still holds
 * apart (`changeRoom`), and a root that deforms declare their own box at each pose instead.
 *
 * The pose before is the one the shadow mobility last saw (`webgpu/shadow/mobility.ts`), taken only
 * when it carries the root's local box to the world box it holds, to the bit: a pose some other way
 * wrote is never taken for the last one, and the root joins its node's box (`movedBatch.ts`) or
 * its row's (`placement/webgpuPlacements.ts`, the world's meshes). A root declares in its node's
 * turn, once in the call, so a batch of moves declares what the same moves one by one would.
 */

const was = new Float64Array(BOX_VALUES),
  wasMin = was.subarray(0, 3),
  wasMax = was.subarray(3, 6),
  now = new Float64Array(BOX_VALUES),
  nowMin = now.subarray(0, 3),
  nowMax = now.subarray(3, 6),
  local = new Float64Array(BOX_VALUES)
/** Per root rank: 0, or while its move in this call is its own (`noteOwnMove`), where its last
 *  seen pose is kept in `poses`, plus one — negated once declared. */
let own = new Int32Array(0),
  poses = new Float64Array(16),
  ranks = new Int32Array(1),
  kept = 0

/** Whether root `rank`, about to move, declares its own change: its last seen pose is the one its
 *  world box was made at, kept for the pass (`declareOwnMove`) until `forgetOwnMoves`. */
export function noteOwnMove(rt: WebgpuPagesRuntime, rank: number) {
  if (rank < own.length && own[rank]) return true
  const roots = rt.layout.selectionRoots,
    { localBox, worldBox } = roots[rank],
    pose = rt.lights.mobility.poseOf(rank)
  if (!localBox || !worldBox || !pose) return false
  boxTransform(was, 0, localBox, 0, pose)
  if (!boxEquals(was, 0, worldBox, 0)) return false
  if (own.length < roots.length) own = grown(own, Int32Array, roots.length)
  if (kept === ranks.length) {
    ranks = grown(ranks, Int32Array, 2 * kept)
    poses = grown(poses, Float64Array, 2 * poses.length)
  }
  poses.set(pose, kept * 16)
  ranks[kept] = rank
  own[rank] = ++kept
  return true
}

/** True when root `rank`'s change is its own (`declareOwnMove`), not its node's. */
export const ownsMove = (rank: number) => rank < own.length && own[rank] !== 0

/** The call is done: no root's change is noted any more. */
export function forgetOwnMoves() {
  for (let i = 0; i < kept; i++) own[ranks[i]] = 0
  kept = 0
}

/** `box` at `world` declared, and at the last seen pose `pose` when given: one box when the two
 *  meet. */
function declarePair(
  rt: WebgpuPagesRuntime,
  box: ArrayLike<number>,
  world: ArrayLike<number>,
  movingOnly: boolean,
  pose?: ArrayLike<number>,
) {
  const { changes } = rt.lights
  boxTransform(now, 0, box, 0, world)
  if (!pose) return changes.worldChanged(nowMin, nowMax, movingOnly)
  boxTransform(was, 0, box, 0, pose)
  let meet = true
  for (let axis = 0; axis < 3; axis++)
    meet &&= was[axis] <= now[axis + 3] && now[axis] <= was[axis + 3]
  if (meet) boxUnionBatch(was, now, 1)
  changes.worldChanged(wasMin, wasMax, movingOnly)
  if (!meet) changes.worldChanged(nowMin, nowMax, movingOnly)
}

/** Whether record `rec` bounds the same box as `prev`: a dynamic primitive's pages all hold its
 *  primitive's box, declared once. */
function sameBox(rec: PageRec, prev: PageRec) {
  for (let axis = 0; axis < 3; axis++)
    if (rec.min[axis] !== prev.min[axis] || rec.max[axis] !== prev.max[axis]) return false
  return true
}

/** Whether every record of `pages` is a leaf of its primitive: none stands for others. */
function leavesOnly(pages: readonly PageRec[]) {
  for (const rec of pages) if ((rec.level ?? 0) > 0) return false
  return true
}

/** Whether `root`'s cluster boxes are all it can draw, and the plan's list still holds them apart. */
function clustersStandFor(rt: WebgpuPagesRuntime, rank: number) {
  const root = rt.layout.selectionRoots[rank]
  return (
    root.boxes === true &&
    !root.deformation &&
    !root.reach &&
    4 * 2 * root.pages.length <= rt.lights.changes.room() &&
    leavesOnly(root.pages)
  )
}

/** Root `rank`'s cluster boxes declared at `world`, and at its last seen `pose` when given
 *  (`declarePair`); records bounding the box of the one before them, once. */
function declareClusters(
  rt: WebgpuPagesRuntime,
  rank: number,
  world: ArrayLike<number>,
  movingOnly: boolean,
  pose?: ArrayLike<number>,
) {
  const { pages } = rt.layout.selectionRoots[rank]
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i]
    if (i > 0 && sameBox(rec, pages[i - 1])) continue
    local.set(rec.min, 0)
    local.set(rec.max, 3)
    declarePair(rt, local, world, movingOnly, pose)
  }
}

/**
 * Root `rank` shown, hidden, or turned to cast or not where it stands (`min`, `max` its box): each
 * cluster's box at its pose, as a move declares them below, so a root whose pieces lie apart —
 * two drops of wax at both ends of a lamp — stales the pages under its pieces, not the room
 * between them. Its own box when its clusters cannot stand for it.
 */
export function declareInPlace(
  rt: WebgpuPagesRuntime,
  rank: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  movingOnly: boolean,
) {
  if (!clustersStandFor(rt, rank)) return rt.lights.changes.worldChanged(min, max, movingOnly)
  declareClusters(rt, rank, rt.layout.selectionRoots[rank].world.elements, movingOnly)
}

/**
 * Root `rank`'s own change, once in the call: each cluster's box, or its own, at its last seen pose
 * and its new one. `promoted`, its first move: its pages go stale whole.
 */
export function declareOwnMove(rt: WebgpuPagesRuntime, rank: number, promoted: boolean) {
  if (own[rank] <= 0) return
  const root = rt.layout.selectionRoots[rank],
    pose = poses.subarray((own[rank] - 1) * 16, own[rank] * 16),
    world = root.world.elements
  own[rank] = -own[rank]
  if (!clustersStandFor(rt, rank)) return declarePair(rt, root.localBox!, world, !promoted, pose)
  declareClusters(rt, rank, world, !promoted, pose)
}
