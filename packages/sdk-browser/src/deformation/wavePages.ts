import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { BOX_VALUES, boxUnion } from '../../../math/src/geometry/box.ts'
import { encloseTransform, ROUND, widenBox } from '../webgpu/water/precision.ts'
import type { Waves } from '../../../sdk-core/src/fluids/waves.ts'
import type { PageRec } from '../page/selection/types.ts'
import { holdPageBoxes, releasePageBoxes } from '../webgpu/pages/render/movedGeometry.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { DeformationFrame } from './frame.ts'

/** WGSL's sine and cosine stray from the true value by at most 2⁻¹¹ (the WGSL specification's
 *  accuracy of built-in functions): a wave moves a vertex by that share of its reach past the
 *  exact box. */
const TRIG_ERROR = 2 ** -11

const inverse = new Float64Array(16),
  rest = new Float64Array(BOX_VALUES),
  world = new Float64Array(BOX_VALUES),
  shift = new Float64Array(BOX_VALUES),
  local = new Float64Array(BOX_VALUES),
  error = new Float64Array(3)

/** How far the GPU's float32 waves — the first `count` of `model` — may carry a vertex of the
 *  displaced world box `box` past the exact displacement: per wave, its reach times its sine's or
 *  cosine's error and its phase's float32 rounding (`ROUND`) at the phase's magnitude there. */
function waveSlack(model: Waves, count: number, box: Float64Array) {
  let far = 0
  for (let c = 0; c < 6; c++) far = Math.max(far, Math.abs(box[c]))
  let slack = 0
  for (let i = 0; i < Math.min(count, model.count); i++) {
    const phase = model.k[i] * 2 * far + Math.abs(model.phase[i])
    slack += (model.amplitude[i] + model.lateral[i]) * (TRIG_ERROR + ROUND * phase)
  }
  return slack
}

/** Writes into `local` the box of page `rec` of a placement at `e` (`inverse` its inverse), in its
 *  frame, where the first `count` of `model`'s waves carry its vertices — its own box with none:
 *  its rest box carried to the world with the GPU's float32 error (`encloseTransform`), grown by
 *  the displacement box of its rectangle (`Waves.displacementBox`), by the float32 waves' error
 *  and the sum's rounding (`widenBox`), then carried back the same way. False when a transform
 *  bounds nothing (a singular or non-finite pose). */
function pageBox(rec: PageRec, e: ArrayLike<number>, model: Waves | null, count: number) {
  rest.set(rec.min, 0)
  rest.set(rec.max, 3)
  if (!model) return (local.set(rest), true)
  if (!encloseTransform(world, rest, e, error)) return false
  model.displacementBox(world[0], world[2], world[3], world[5], shift, count)
  for (let c = 0; c < 6; c++) world[c] += shift[c]
  widenBox(world, waveSlack(model, count, world))
  return encloseTransform(local, world, inverse, error)
}

/** One record set the waves alone bound: every placement drawing its pages, and their boxes. */
type Group = { ranks: number[]; boxes: Float64Array }
/** The groups of a session's deformation (`frame`), found once for its roots. */
const plans = new WeakMap<DeformationFrame, { roots: number; groups: Group[] }>()

/** A page `PageRec.moved` may bound: a leaf — no coarser form stands for it, it stands for none,
 *  so no level of a cut reads another's bounds —, of a geometry no rewrite bounds. */
const boundable = (rec: PageRec) =>
  (rec.level ?? 0) === 0 && rec.parentError == null && rec.sourceMesh?.geometry.usage !== 'dynamic'

/** The record sets of `roots` every placement of which the waves alone move, their pages all
 *  boundable: the sets `PageRec.moved` bounds for every placement that reads it. */
function groupsOf(roots: WebgpuPagesRuntime['layout']['selectionRoots'], frame: DeformationFrame) {
  const plan = plans.get(frame)
  if (plan?.roots === roots.length) return plan.groups
  const byPages = new Map<readonly PageRec[], number[]>()
  roots.forEach(({ pages }, i) => {
    const ranks = byPages.get(pages)
    if (ranks) ranks.push(i)
    else byPages.set(pages, [i])
  })
  const groups: Group[] = []
  for (const [pages, ranks] of byPages)
    if (
      ranks.every((i) => frame.bases[i] && frame.wavesAlone(i) !== undefined) &&
      pages.every(boundable)
    )
      groups.push({ ranks, boxes: new Float64Array(pages.length * BOX_VALUES) })
  plans.set(frame, { roots: roots.length, groups })
  return groups
}

/** Whether a placement of `group` holds a record written anew this frame (`frame.dirty`). */
function written(group: Group, frame: DeformationFrame) {
  for (const rank of group.ranks) if (frame.dirty[rank]) return true
  return false
}

/** Writes `group`'s boxes, the union over its placements; false when a pose bounds nothing. */
function writeGroup(
  group: Group,
  frame: DeformationFrame,
  roots: { world: { elements: ArrayLike<number> }; pages: readonly PageRec[] }[],
) {
  const { ranks, boxes } = group
  for (let n = 0; n < ranks.length; n++) {
    const { world: placed, pages } = roots[ranks[n]],
      e = placed.elements,
      model = frame.wavesAlone(ranks[n]) ?? null,
      count = frame.drawnWaves(ranks[n])
    if (model) invertMatrix4(inverse, e)
    for (let k = 0, at = 0; k < pages.length; k++, at += BOX_VALUES) {
      if (!pageBox(pages[k], e, model, count)) return false
      if (n) boxUnion(boxes, at, local[0], local[1], local[2], local[3], local[4], local[5])
      else boxes.set(local, at)
    }
  }
  return true
}

/**
 * THE PAGES THE WAVES CARRY: each page of a record set whose every placement the waves
 * alone move is bounded where its vertices are this frame, as a rewritten dynamic page is
 * (`PageRec.moved`) — its shadow sphere, its occlusion corners, its transparent corners —,
 * not by its rest box grown on every side by the crest of every wave: a sea's pages, tall by a
 * wave's height where they stand, bound the shadow pages they colour. The placements sharing the
 * records — the rows of one batch, parked ones too — take the union of theirs; a page drawn at
 * rest takes its own box. Records none of them wrote anew this frame (`frame.dirty`: no wave, pose
 * or rest moved) keep their boxes. Any other record set — a joint, a target or a soft source among
 * its sources, a page of a coarser level or of a rewritten geometry — keeps its rest box grown by its reach, and so does one a pose bounds nothing for.
 */
export function updateWavePages(rt: WebgpuPagesRuntime, frame: DeformationFrame) {
  const roots = rt.layout.selectionRoots
  for (const group of groupsOf(roots, frame)) {
    if (!written(group, frame)) continue
    if (writeGroup(group, frame, roots)) holdPageBoxes(rt, group.ranks, group.boxes)
    else releasePageBoxes(rt, group.ranks)
  }
}
