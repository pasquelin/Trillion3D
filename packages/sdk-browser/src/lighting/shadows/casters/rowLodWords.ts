import type { PageRec, MovedBox } from '../../../geometry/selection/types.ts'

import { f32Bits, fromF64Words } from '../../../../../math/src/float/bits.ts'
import { boxCenter } from '../../../../../math/src/geometry/box.ts'
import { sphereFromBounds } from '../../../../../math/src/geometry/sphere.ts'
import { rowBox, rowGrowth } from '../../../visibility/hiz/corners.ts'
import { objectSphere, type ObjectRoot } from './objectSphere.ts'

/** Own/parent world centres and errors, their low residues, then two world radii, the radius of
 *  the root's world box (0 for none) and padding, then the row's whole object (`LOD_OBJECT`): the
 *  offset of its centre from the row's own sphere's, its radius. */
export const ROW_LOD_FLOATS = 24
/** The first word of the row's whole object among its detail words: three of offset, one of radius
 *  (`VsmRenderRowLod.object`). */
export const LOD_OBJECT = 20
const moved = new Float64Array(4)
/** The sphere of `box`, in a scratch the next call rewrites. */
function movedSphere({ min, max }: MovedBox) {
  sphereFromBounds(moved, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  return moved
}

/** Doubles of a row's detail inputs (`rowLodInputs`): what its words are made of beyond its root's
 *  world, which the CPU writes with the row and the rows pass reads
 *  (`../../../placement/rows/rowWordsWgsl.ts`, `composeLod`) whenever the root moves. */
export const ROW_LOD_INPUT_DOUBLES = 13
/** The inputs' bits (`LOD_INPUT.flags`): the row has a detail, its finer group and itself are
 *  ready, it has a coarser form, its root has a world box; and the row holds a page (`record`, set
 *  by `../../../placement/rows/rowInputPack.ts`): a row without one has every derived word zero — its
 *  sphere, its corners — and its detail drawn by every page. */
export const LOD_BIT = {
  has: 1,
  childReady: 2,
  ready: 4,
  hasParent: 8,
  hasBox: 16,
  record: 32,
} as const
/** Where each input lies: the sphere and its radius grown (centre, radius), the coarser form's,
 *  the own error and the coarser one's before the stretch, the bits, and the row's whole object —
 *  four singles in two doubles, `rowObjectInputs`. */
export const LOD_INPUT = {
  sphere: 0,
  parentSphere: 4,
  own: 8,
  parent: 9,
  flags: 10,
  object: 11,
} as const

const object = new Float64Array(4),
  middle = new Float64Array(3)

/**
 * The sphere of the whole object row `rec` belongs to (`objectSphere`), into the inputs `into` from
 * `o`, at `LOD_INPUT.object`: its centre's offset from the row's own box centre, in the root's space,
 * then its radius, four singles — the high word of each double holds the first of its two, the low
 * word the second. None (zeros) for a root with no box, or a sphere no single holds. The one place a
 * row's object is written: a blended caster's row holds no other detail.
 */
export function rowObjectInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: ObjectRoot | undefined,
) {
  if (!rec || !root || !objectSphere(object, 0, rec, root)) return
  const { min, max } = rowBox(rec)
  boxCenter(middle, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  const dx = Math.fround(object[0] - middle[0]),
    dy = Math.fround(object[1] - middle[1]),
    dz = Math.fround(object[2] - middle[2]),
    radius = Math.fround(object[3])
  if (![dx, dy, dz, radius].every(Number.isFinite) || !(radius > 0)) return
  into[o + LOD_INPUT.object] = fromF64Words(f32Bits(dx), f32Bits(dy))
  into[o + LOD_INPUT.object + 1] = fromF64Words(f32Bits(dz), f32Bits(radius))
}

/**
 * Row `row`'s detail inputs, into `into` from `o`: the sphere of its level of detail — its dynamic
 * box's where it has one — and the coarser form's, the errors each grown by the deformation reach
 * as the cut grows them, the radii by what bounds the page, and the bits the cut rule's
 * residency (`ready`, `childReady`) and the root's box set. All of it is what a world does not
 * change: the same words stand while a parent moves the root.
 */
export function rowLodInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: ObjectRoot | undefined,
  ready = true,
  childReady = true,
) {
  into.fill(0, o, o + ROW_LOD_INPUT_DOUBLES)
  rowObjectInputs(into, o, rec, root)
  let flags = 0
  // A root has a world box when it has a local box to carry: the one the GPU carries by its world
  // (`../../../placement/roots/rootBoxesWgsl.ts`), whose radius the detail reads.
  const local = root?.localBox
  if (root?.worldBox && local && local[3] >= local[0]) flags |= LOD_BIT.hasBox
  if (root && rec?.sphere && rec.lodError !== undefined) {
    flags |= LOD_BIT.has | (childReady ? LOD_BIT.childReady : 0) | (ready ? LOD_BIT.ready : 0)
    // A page bounded where its vertices are (`rowBox`) takes its box's sphere, which no reach
    // grows; its errors still grow by the reach, as far as the deformation carries a finer form from
    // the coarser one — a dynamic page, a leaf with no coarser form, has none to grow.
    const grow = rowGrowth(rec, root.reach),
      reach = 2 * (root.reach ?? 0),
      sphere = rec.moved ? movedSphere(rec.moved) : rec.sphere
    for (let axis = 0; axis < 3; axis++) into[o + LOD_INPUT.sphere + axis] = sphere[axis]
    into[o + LOD_INPUT.sphere + 3] = sphere[3] + grow
    into[o + LOD_INPUT.own] = rec.lodError + ((rec.level ?? 0) > 0 ? reach : 0)
    const parent = rec.parentError ?? -1
    if (parent >= 0 && rec.parentSphere) {
      flags |= LOD_BIT.hasParent
      const parentSphere = rec.parentSphere
      for (let axis = 0; axis < 3; axis++)
        into[o + LOD_INPUT.parentSphere + axis] = parentSphere[axis]
      into[o + LOD_INPUT.parentSphere + 3] = rec.parentSphere[3] + grow
      into[o + LOD_INPUT.parent] = parent + reach
    }
  }
  into[o + LOD_INPUT.flags] = flags
}
