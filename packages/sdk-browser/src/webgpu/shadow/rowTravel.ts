/**
 * THE ROWS' MOTION COMMITTED, once a frame before the rows go up (`../../placement/rowWords.ts`):
 * the rows the pass derives for another reason than a moving placement's travel, and the farthest
 * any moving placement's row went, added to the spheres' running sums
 * (`../../gpu/shadow/rowMotion.ts`) the chunk bound reads (`../../vsm/rowPageBound.ts`).
 *
 * A row's sphere holds its local box (centre `c`, half extent `h`, its root's reach in it) under its
 * root's world (`../../placement/rowSphere.ts`): a world whose translation moves by `a` and whose
 * linear part moves by `b` (Frobenius) moves the sphere's centre by at most `a + b·|c|` and grows
 * its radius by at most `b·|h|` — the new sphere lies in the old one grown by `a + b·ρ`, ρ = |c| +
 * |h|. A root's ρ is bounded from the box its pages lie in: its own local box, and its dynamic pages'
 * boxes (`PageRec.moved`, their union `movedPagesBox`), grown by its reach: the farthest corner's distance plus the half diagonal.
 * A parent slot moves its roots by `ΔP·C`: their points at `|t_C| + |L_C|·ρ` of its origin.
 */
import { commitMotion } from '../../gpu/shadow/rowMotion.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'

import type { ComposeState } from '../../placement/gpuComposeState.ts'
import { takeFarthest } from './mobilityTravel.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { movedPagesBox } from '../pages/render/movedGeometry.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

const box = new Float64Array(6)
const ascending = (a: number, b: number) => a - b

/** ρ of `root`: no row of it lies farther from its origin, centre and half extent summed;
 *  unbounded without a local box. Its pages' own boxes are read as their one union, kept where
 *  they are written (`movedPagesBox`): one look a mover, whatever its pages. */
function rootReach(root: ClusterRoot<PageRec> | undefined) {
  const local = root?.localBox
  if (!root || !local || !(local[3] >= local[0])) return Infinity
  box.set(local)
  const moved = movedPagesBox(root.pages)
  if (moved)
    for (let a = 0; a < 3; a++) {
      box[a] = Math.min(box[a], moved[a])
      box[3 + a] = Math.max(box[3 + a], moved[3 + a])
    }
  const reach = root.reach ?? 0
  let corner = 0,
    half = 0
  for (let a = 0; a < 3; a++) {
    const low = box[a] - reach,
      high = box[3 + a] + reach
    corner += Math.max(Math.abs(low), Math.abs(high)) ** 2
    half += ((high - low) / 2) ** 2
  }
  return (Math.sqrt(corner) + Math.sqrt(half)) * (1 + 2 ** -40)
}

/** ρ of slot `slot`'s roots about its parent's origin: the farthest of `|t_C| + |L_C|·ρ`. */
function slotReach(rt: WebgpuPagesRuntime, state: ComposeState | undefined, slot: number) {
  const ranks = state?.ranksOf[slot]
  if (!state || !ranks) return Infinity
  let reach = 0
  for (const rank of ranks) {
    if (state.parentOf[rank] !== slot) continue
    // Its local matrix read in place: no view made per root.
    const m = state.localMats,
      o = rank * 16
    let linear = 0
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) linear += m[o + c * 4 + r] ** 2
    const t = hypot3(m[o + 12], m[o + 13], m[o + 14])
    reach = Math.max(reach, t + Math.sqrt(linear) * rootReach(rt.layout.selectionRoots[rank]))
  }
  return reach * (1 + 2 ** -40)
}

/**
 * This frame's motion committed: `derived` rows the CPU named, the rows of the placements that
 * jumped (`mobilityTravel.ts`) or whose reach is unbounded, and the farthest a moved placement's or
 * slot's row went. The mobility's sums are taken whether or not the spheres exist: none is kept
 * for a later frame.
 */
export function commitRowMotion(rt: WebgpuPagesRuntime, derived: number) {
  const { travel } = rt.lights.mobility,
    roots = rt.layout.selectionRoots,
    state = rt.compose
  let rows = derived
  const whole = (rank: number) => void (rows += roots[rank]?.pages.length ?? 0)
  // A placement counted whole holds its rows: its travel bounds none of them. It may be named
  // more than once a frame (let go, then its next move, then its promotion): sorted, each once.
  const jumped = travel.jumped.sort(ascending)
  for (let k = 0; k < jumped.length; k++) {
    const rank = jumped[k]
    if (k > 0 && rank === jumped[k - 1]) continue
    whole(rank)
    if (rank < travel.ranks.a.length) travel.ranks.a[rank] = travel.ranks.b[rank] = 0
  }
  jumped.length = 0
  const farthest = Math.max(
    takeFarthest(travel.ranks, (rank) => rootReach(roots[rank]), whole),
    takeFarthest(
      travel.slots,
      (slot) => slotReach(rt, state, slot),
      (slot) => {
        for (const rank of state?.ranksOf[slot] ?? [])
          if (state!.parentOf[rank] === slot) whole(rank)
      },
    ),
  )
  const spheres = rt.lights.spheres
  if (spheres) commitMotion(spheres.motion, rows, farthest)
}
