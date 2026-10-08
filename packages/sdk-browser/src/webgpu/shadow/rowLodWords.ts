import { transformAffinePoint } from '../../../../sdk-core/src/index.ts'
import { FINITE_SENTINEL } from '../../../../math/src/constants.ts'
import { writeSplitDouble } from '../../gpu/partition/contract.ts'
import { worldStretch } from '../../page/cut/logic.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { MovedBox } from '../../page/selection/types.ts'
import { sphereFromBounds } from '../../../../math/src/geometry/sphere.ts'
import { boxRadius } from '../../../../math/src/geometry/box.ts'
import { rowGrowth } from '../../hiz/corners.ts'
import type { Placements } from '../../page/selection/placements.ts'

/** Own/parent world centres and errors, their low residues, then two world radii, the radius of
 *  the row's whole object (its root's world box, 0 for none) and padding. */
export const ROW_LOD_FLOATS = 20
const centre = new Float64Array(3),
  moved = new Float64Array(4)
/** The sphere of `box`, in a scratch the next call rewrites. */
function movedSphere({ min, max }: MovedBox) {
  sphereFromBounds(moved, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  return moved
}

/** The world centre of local sphere `sphere` and its world error `error`, at `out[at]`. */
function writeError(
  out: Float32Array,
  at: number,
  e: ArrayLike<number>,
  sphere: ArrayLike<number>,
  error: number,
) {
  transformAffinePoint(centre, e, sphere[0], sphere[1], sphere[2], 0)
  for (let axis = 0; axis < 3; axis++) writeSplitDouble(out, at + axis, at + 8 + axis, centre[axis])
  out[at + 3] = error
}

/**
 * Writes row `row`'s detail: the world error of its own form and of the coarser one that
 * replaces it, each at its level-of-detail sphere's world centre, as the GPU cut projects them
 * (`../../gpu/dag/shader/error.ts`): the local error, grown by the placement's deformation reach
 * past the finest level, by the placement's stretch (`worldStretch`, the cut's own). The cut rule's residency is folded in
 * (`../../page/cut/rule.ts`): a row not `ready` carries a parent error of 0, so no page draws it;
 * one whose finer group is not ready (`childReady`), an own error of 0, so every page that reaches
 * it draws it. A row with no record — a blended caster's is given none — or of a cache without
 * errors is drawn by every page.
 */
export function writeRowLod(
  out: Float32Array,
  row: number,
  rec: PageRec | undefined,
  root: (Placements[number] & { readonly worldBox?: ArrayLike<number> }) | undefined,
  ready = true,
  childReady = true,
) {
  const at = row * ROW_LOD_FLOATS
  out.fill(0, at, at + ROW_LOD_FLOATS)
  // A row with no coarser form carries `FINITE_SENTINEL` as its parent's error: every page
  // wants finer.
  out[at + 7] = FINITE_SENTINEL
  const box = root?.worldBox
  // The object's bounding radius: the screen-size cull is an instance test.
  if (box && box[3] >= box[0]) out[at + 18] = boxRadius(box)
  if (!root || !rec?.sphere || rec.lodError === undefined) return
  // A page bounded where its vertices are (`rowBox`) takes its box's sphere, which no reach
  // grows; its errors still grow by the reach, as far as the deformation carries a finer form from
  // the coarser one — a dynamic page, a leaf with no coarser form, has none to grow.
  const grow = rowGrowth(rec, root.reach),
    e = root.world.elements,
    reach = 2 * (root.reach ?? 0),
    scale = worldStretch(root),
    sphere = rec.moved ? movedSphere(rec.moved) : rec.sphere
  const own = rec.lodError + ((rec.level ?? 0) > 0 ? reach : 0)
  writeError(out, at, e, sphere, childReady ? own * scale : 0)
  out[at + 16] = (sphere[3] + grow) * scale
  const parent = rec.parentError ?? -1
  if (!ready) out[at + 7] = 0
  else if (parent >= 0 && rec.parentSphere) {
    writeError(out, at + 4, e, rec.parentSphere, (parent + reach) * scale)
    out[at + 17] = (rec.parentSphere[3] + grow) * scale
  }
}
