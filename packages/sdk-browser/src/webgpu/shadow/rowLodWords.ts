import { transformAffinePoint } from '../../../../sdk-core/src/index.ts'
import { FINITE_SENTINEL } from '../../../../math/src/constants.ts'
import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
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

/** Doubles of a row's detail inputs (`rowLodInputs`): what its words are made of beyond its root's
 *  world, which the CPU writes with the row (`writeRowLod`) and the compose rows pass reads
 *  (`placement/composedRowInputs.ts`) to remake the words under a parent that moved. */
export const ROW_LOD_INPUT_DOUBLES = 12
/** The inputs' bits (`LOD_FLAGS`): the row has a detail, its finer group and itself are ready, it
 *  has a coarser form, its root has a world box. */
const LOD_HAS = 1,
  LOD_CHILD_READY = 2,
  LOD_READY = 4,
  LOD_HAS_PARENT = 8,
  LOD_HAS_BOX = 16
/** Where each input lies: the sphere and its radius grown (centre, radius), the coarser form's,
 *  the own error and the coarser one's before the stretch, the bits. */
const LOD_SPHERE = 0,
  LOD_PARENT_SPHERE = 4,
  LOD_OWN = 8,
  LOD_PARENT = 9
export const LOD_FLAGS = 10

/**
 * Row `row`'s detail inputs, into `into` from `o`: the sphere of its level of detail — its dynamic
 * box's where it has one — and the coarser form's, the errors each grown by the deformation reach
 * as `writeRowLod` grows them, the radii by what bounds the page, and the bits the cut rule's
 * residency (`ready`, `childReady`) and the root's box set. All of it is what a world does not
 * change: the same words stand while a parent moves the root.
 */
export function rowLodInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: (Placements[number] & { readonly worldBox?: ArrayLike<number> }) | undefined,
  ready = true,
  childReady = true,
) {
  into.fill(0, o, o + ROW_LOD_INPUT_DOUBLES)
  let flags = 0
  const box = root?.worldBox
  if (box && box[3] >= box[0]) flags |= LOD_HAS_BOX
  if (root && rec?.sphere && rec.lodError !== undefined) {
    flags |= LOD_HAS | (childReady ? LOD_CHILD_READY : 0) | (ready ? LOD_READY : 0)
    // A page bounded where its vertices are (`rowBox`) takes its box's sphere, which no reach
    // grows; its errors still grow by the reach, as far as the deformation carries a finer form from
    // the coarser one — a dynamic page, a leaf with no coarser form, has none to grow.
    const grow = rowGrowth(rec, root.reach),
      reach = 2 * (root.reach ?? 0),
      sphere = rec.moved ? movedSphere(rec.moved) : rec.sphere
    into.set(sphere.slice(0, 3), o + LOD_SPHERE)
    into[o + LOD_SPHERE + 3] = sphere[3] + grow
    into[o + LOD_OWN] = rec.lodError + ((rec.level ?? 0) > 0 ? reach : 0)
    const parent = rec.parentError ?? -1
    if (parent >= 0 && rec.parentSphere) {
      flags |= LOD_HAS_PARENT
      into.set(rec.parentSphere.slice(0, 3), o + LOD_PARENT_SPHERE)
      into[o + LOD_PARENT_SPHERE + 3] = rec.parentSphere[3] + grow
      into[o + LOD_PARENT] = parent + reach
    }
  }
  into[o + LOD_FLAGS] = flags
}

/**
 * Row detail words `at` of `out` from the inputs `inputs` at `o`, the root's world `e`, its
 * stretch `scale` (`worldStretch`) and the radius of its world box `boxRadius`: the world error of
 * its own form and of the coarser one that replaces it, each at its level-of-detail sphere's world
 * centre, as the GPU cut projects them (`../../gpu/dag/shader/error.ts`). The cut rule's residency
 * is folded in (`../../page/cut/rule.ts`): a row not `ready` carries a parent error of 0, so no
 * page draws it; one whose finer group is not ready, an own error of 0, so every page that reaches
 * it draws it. A row with no record — a blended caster's is given none — or of a cache without
 * errors is drawn by every page.
 */
function applyRowLod(
  out: Float32Array,
  at: number,
  inputs: Float64Array,
  o: number,
  e: ArrayLike<number>,
  scale: number,
  boxRadius: number,
) {
  out.fill(0, at, at + ROW_LOD_FLOATS)
  // A row with no coarser form carries `FINITE_SENTINEL` as its parent's error: every page
  // wants finer.
  out[at + 7] = FINITE_SENTINEL
  const flags = inputs[o + LOD_FLAGS]
  // The object's bounding radius: the screen-size cull is an instance test.
  if (flags & LOD_HAS_BOX) out[at + 18] = boxRadius
  if (!(flags & LOD_HAS)) return
  const sphere = inputs.subarray(o + LOD_SPHERE, o + LOD_SPHERE + 4)
  writeError(out, at, e, sphere, flags & LOD_CHILD_READY ? inputs[o + LOD_OWN] * scale : 0)
  out[at + 16] = sphere[3] * scale
  if (!(flags & LOD_READY)) out[at + 7] = 0
  else if (flags & LOD_HAS_PARENT) {
    const parent = inputs.subarray(o + LOD_PARENT_SPHERE, o + LOD_PARENT_SPHERE + 4)
    writeError(out, at + 4, e, parent, inputs[o + LOD_PARENT] * scale)
    out[at + 17] = parent[3] * scale
  }
}

const inputsScratch = new Float64Array(ROW_LOD_INPUT_DOUBLES)

/** Writes row `row`'s detail (`applyRowLod`, over its inputs, `rowLodInputs`) at its root's world. */
export function writeRowLod(
  out: Float32Array,
  row: number,
  rec: PageRec | undefined,
  root: (Placements[number] & { readonly worldBox?: ArrayLike<number> }) | undefined,
  ready = true,
  childReady = true,
) {
  rowLodInputs(inputsScratch, 0, rec, root, ready, childReady)
  const box = root?.worldBox
  applyRowLod(
    out,
    row * ROW_LOD_FLOATS,
    inputsScratch,
    0,
    root?.world.elements ?? IDENTITY,
    root ? worldStretch(root) : 1,
    box && box[3] >= box[0] ? boxRadius(box) : 0,
  )
}

const IDENTITY = new Float64Array(16)
