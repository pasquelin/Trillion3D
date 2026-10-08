import { closestSegmentTriangle, triangleNormal } from './closest.ts'
import { gatherTrianglesInBox, overlapsTriangle } from './triangleQuery.ts'
import type { TriangleTree } from './triangleTree.ts'
import { boxEmpty, boxExpandByPoint, boxGrow } from '../../../math/src/geometry/box.ts'
import { dotVector3, normalizeVector3, scaleVector3 } from '../../../math/src/vector/vector.ts'

/**
 * AN UPRIGHT CAPSULE against a triangle tree: the narrow phase of the character body. The
 * capsule stands on `feet` — the lowest point of its bottom sphere — and is every point within
 * `radius` of the vertical segment from `feet + radius` to `feet + height - radius`.
 *
 * A pass finds every triangle nearer than `radius` to that segment and hands each overlap to
 * `push` at once (`CapsuleContact`). The caller moves `feet`; the next triangle of the pass is
 * measured from the moved capsule, so two walls meeting in a corner are both left in one pass.
 */
export interface Capsule {
  /** The lowest point, world space; `push` moves it. */
  readonly feet: Float64Array
  /** Radius of the body, metres. */
  radius: number
  /** Height from the feet to the top of the head, metres; at least two radii. */
  height: number
}

/**
 * One overlap of a capsule and a surface. The arrays are reused: a push reads them during the
 * call only.
 */
export interface CapsuleContact {
  /** Unit direction out of the surface into the capsule: the way out. */
  readonly normal: Float64Array
  /**
   * Unit normal of the surface itself, on the capsule's side. It differs from `normal` when
   * the capsule touches an edge or a corner: it says which face that edge belongs to.
   */
  readonly surface: Float64Array
  /** The touched point of the surface, world space. */
  readonly point: Float64Array
  /** How far the capsule is inside the surface along `normal`, > 0. */
  depth: number
}

/** Answers one contact, typically by moving the capsule's `feet` out of it. */
export type CapsulePush = (contact: CapsuleContact) => void

const segment = new Float64Array(6),
  closest = new Float64Array(6),
  normal = new Float64Array(3),
  contact: CapsuleContact = {
    normal,
    surface: new Float64Array(3),
    point: closest.subarray(3),
    depth: 0,
  },
  box = new Float64Array(6),
  min = box.subarray(0, 3),
  max = box.subarray(3)

/** The triangles of the last box a capsule gathered on a tree, grown by two radii past its pass's
 *  box, and that box, its bounds also seen as `min` and `max`. */
type Gathered = {
  list: Int32Array
  count: number
  box: Float64Array
  min: Float64Array
  max: Float64Array
}

/** Per tree and capsule, what it gathered last: the following passes of a step (and of the next
 *  frames, while the capsule stays inside) filter it instead of walking the tree again, and two
 *  capsules on one tree never take each other's box. Weak: a dropped tree or capsule takes its
 *  list with it. */
const gathered = new WeakMap<TriangleTree, WeakMap<Capsule, Gathered>>()

function placeSegment(capsule: Capsule) {
  const { feet, radius } = capsule,
    reach = Math.max(capsule.height - radius, radius)
  segment[0] = segment[3] = feet[0]
  segment[2] = segment[5] = feet[2]
  segment[1] = feet[1] + radius
  segment[4] = feet[1] + reach
}

/**
 * One pass of `capsule` against `tree`; returns whether anything overlapped. The query box is
 * the capsule's at the start of the pass grown by one radius, the farthest a push of this pass
 * can carry it.
 */
export function capsulePass(tree: TriangleTree, capsule: Capsule, push: CapsulePush) {
  const { radius } = capsule
  placeSegment(capsule)
  boxEmpty(box, 0)
  boxExpandByPoint(box, 0, segment[0], segment[1], segment[2])
  boxExpandByPoint(box, 0, segment[3], segment[4], segment[5])
  boxGrow(box, 0, box, 0, 2 * radius)
  let onTree = gathered.get(tree)
  if (!onTree) gathered.set(tree, (onTree = new WeakMap()))
  let near = onTree.get(capsule)
  if (!near) {
    const bounds = new Float64Array(6)
    onTree.set(
      capsule,
      (near = {
        list: new Int32Array(64),
        count: 0,
        box: bounds,
        min: bounds.subarray(0, 3),
        max: bounds.subarray(3),
      }),
    )
  }
  // Inside the gathered box (NaN never is), the list filtered by the box test is the tree's visit
  // of `[min, max]`, same triangles in the same order.
  if (!(
    min[0] >= near.min[0] &&
    min[1] >= near.min[1] &&
    min[2] >= near.min[2] &&
    max[0] <= near.max[0] &&
    max[1] <= near.max[1] &&
    max[2] <= near.max[2]
  )) {
    boxGrow(near.box, 0, box, 0, 2 * radius)
    near.count = gatherTrianglesInBox(tree, near.min, near.max, near)
  }
  let touched = false
  const { list, count } = near
  for (let i = 0; i < count; i++) {
    const at = list[i]
    if (!overlapsTriangle(tree.triangles, at, min, max)) continue
    placeSegment(capsule)
    const squared = closestSegmentTriangle(closest, segment, tree.triangles, at)
    if (squared >= radius * radius) continue
    const depth = squared > 0 ? separate(Math.sqrt(squared), radius) : pierced(tree, at, radius)
    if (!(depth > 0)) continue
    faceOf(tree, at)
    touched = true
    contact.depth = depth
    push(contact)
  }
  return touched
}

/** The segment passes near the triangle: it leaves along the line between the two closest
 *  points — made unit as the length rule normalises, times `1 / distance` —, by what is missing
 *  to the radius. */
function separate(distance: number, radius: number) {
  const inverse = 1 / distance
  for (let k = 0; k < 3; k++) normal[k] = (closest[k] - closest[3 + k]) * inverse
  return radius - distance
}

/** The triangle's unit normal into `contact.surface`, turned to the capsule's side: the normal
 *  times `±1 / length`, `length` the root of the squares `triangleNormal` sums in `length3`'s
 *  order. A NaN length makes all three NaN, as a corrupt triangle must read. */
function faceOf(tree: TriangleTree, at: number) {
  const face = contact.surface,
    length = Math.sqrt(triangleNormal(face, tree.triangles, at))
  if (length === 0) face.set(normal)
  else scaleVector3(face, (dotVector3(face, normal) < 0 ? -1 : 1) / length)
}

/**
 * The segment passes through the triangle: it leaves along the face normal, towards whichever
 * side needs the shorter push — the side its ends mostly lie on.
 */
function pierced(tree: TriangleTree, at: number, radius: number) {
  const v = tree.triangles
  if (triangleNormal(normal, v, at) === 0) return 0
  normalizeVector3(normal)
  const side = (s: number) =>
    (segment[s] - v[at]) * normal[0] +
    (segment[s + 1] - v[at + 1]) * normal[1] +
    (segment[s + 2] - v[at + 2]) * normal[2]
  const low = Math.min(side(0), side(3)),
    high = Math.max(side(0), side(3))
  if (radius - low <= radius + high) return radius - low
  for (let k = 0; k < 3; k++) normal[k] = -normal[k]
  return radius + high
}
