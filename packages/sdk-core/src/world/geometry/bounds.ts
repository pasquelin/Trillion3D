/**
 * The local bounds of a geometry: every vertex and every shape a morph target gives it. A
 * position is read at the value it stands for, as `drawnTriangles` draws it (`pointAt`): straight
 * from its list when it owns three plain numbers a vertex and no morph target moves it, else
 * vertex by vertex.
 */
import { boxEmpty, boxExpandByPoint } from '../../../../math/src/geometry/box.ts'
import { distanceSqVector3 } from '../../../../math/src/vector/vector.ts'
import type { VertexAttribute } from '../buffer/attribute.ts'
import type { Geometry } from './geometry.ts'
import { Box3 } from '../math/box3.ts'
import { Vector3 } from '../math/vector3.ts'
import type { Sphere } from '../math/volumes.ts'

/** What the bounds read of a geometry: its positions and the morph targets that move them. */
type Morphed = {
  readonly attributes: Readonly<Record<string, VertexAttribute | undefined>>
  readonly morphAttributes: Readonly<Record<string, readonly VertexAttribute[] | undefined>>
  readonly morphTargetsRelative: boolean
}

/** Scratch of the bounds below: the whole box, one corner, the sphere's box and centre. */
const whole = new Float64Array(6),
  scratchBox = new Box3(),
  centre = new Vector3(),
  point = [0, 0, 0],
  base = [0, 0, 0]

/** Position `index` at the value it stands for, a normalised integer scaled back, its three
 *  numbers written into `out`; a position two numbers wide lies in the plane z = 0. */
export function pointAt(attribute: VertexAttribute, index: number, out: number[] = [0, 0, 0]) {
  for (let c = 0; c < 3; c++) out[c] = attribute.getComponent(index, c)
  return out
}

/** Vertex `index` of a morph `target` as it lands (`morphTargetsRelative`: on top of the same
 *  vertex of `position`), written into `out`. */
function morphedAt(
  position: VertexAttribute,
  target: VertexAttribute,
  index: number,
  relative: boolean,
  out: number[],
) {
  pointAt(target, index, out)
  if (relative) {
    pointAt(position, index, base)
    for (let c = 0; c < 3; c++) out[c] += base[c]
  }
  return out
}

/** The position list itself when its stored numbers are its values: owned, three a vertex, not
 *  normalised; `null` for any other. */
export const plainPoints = (attribute: VertexAttribute | undefined) =>
  attribute?.kind === 'attribute' && attribute.itemSize === 3 && !attribute.normalized
    ? attribute
    : null

/** Grows the box `into` by `point` (three numbers at `at`). */
const grow = (into: Float64Array, point: ArrayLike<number>, at: number) =>
  boxExpandByPoint(into, 0, point[at], point[at + 1], point[at + 2])

/** The box of an attribute's vertices, written into `into` (six numbers). */
function spanInto(into: Float64Array, attribute: VertexAttribute) {
  boxEmpty(into, 0)
  for (let i = 0; i < attribute.count; i++) grow(into, pointAt(attribute, i, point), 0)
}

/** The box of the positions and of every shape a morph target gives them, into `whole`; false
 *  with no position. */
function span({ attributes, morphAttributes, morphTargetsRelative: relative }: Morphed) {
  const position = attributes.position
  if (!position) return false
  spanInto(whole, position)
  for (const target of morphAttributes.position ?? [])
    for (let i = 0; i < target.count; i++)
      grow(whole, morphedAt(position, target, i, relative, point), 0)
  return true
}

/** The position read straight from its list (`plainPoints`) when no morph target moves it. */
const plainUnmorphed = ({ attributes, morphAttributes }: Morphed) =>
  morphAttributes.position?.length ? null : plainPoints(attributes.position)

/** Writes the box over every vertex and morphed shape into `box`; empty with no position. */
export function spanBox(box: Box3, morphed: Morphed) {
  const plain = plainUnmorphed(morphed)
  if (plain) return box.setFromArray(plain.array, plain.itemSize)
  if (!span(morphed)) return box.makeEmpty()
  return box.set(
    { x: whole[0], y: whole[1], z: whole[2] },
    { x: whole[3], y: whole[4], z: whole[5] },
  )
}

/** Writes the sphere centred on the box and reaching the farthest vertex or morphed vertex into
 *  `sphere`; left as it is with no position. */
export function spanSphere(sphere: Sphere, morphed: Morphed) {
  const position = morphed.attributes.position,
    plain = plainUnmorphed(morphed)
  if (!position) return sphere
  const { x: cx, y: cy, z: cz } = spanBox(scratchBox, morphed).getCenter(centre)
  let far = 0
  /** Reaches the point of three numbers at `at` in `p`. */
  const reach = (p: ArrayLike<number>, at = 0) => {
    far = Math.max(far, distanceSqVector3(centre.elements, p, 0, at))
  }
  if (plain) for (let i = 0, a = plain.array; i + 2 < a.length; i += 3) reach(a, i)
  else {
    for (let i = 0; i < position.count; i++) reach(pointAt(position, i, point))
    for (const target of morphed.morphAttributes.position ?? [])
      for (let j = 0; j < target.count; j++)
        reach(morphedAt(position, target, j, morphed.morphTargetsRelative, point))
  }
  sphere.center.set(cx, cy, cz)
  sphere.radius = Math.sqrt(far)
  return sphere
}

/** Whether `geometry` reads `attribute` as its stored numbers, a normalised integer unscaled: a
 *  list a world geometry owns, read as stored. The lists of the application's geometry (`_owner`
 *  `'host'`) are read at the value they stand for, and so is a view of an interleaved buffer. Not
 *  asked for a position, which every owner reads at its value (`pointAt`). */
export const readsStored = (geometry: Pick<Geometry, '_owner'>, attribute: VertexAttribute) =>
  geometry._owner === 'world' && attribute.kind === 'attribute'

/** Number `component` of vertex `index` of `attribute` as `geometry` reads it (`readsStored`). */
export const readComponent = (
  geometry: Pick<Geometry, '_owner'>,
  attribute: VertexAttribute,
  index: number,
  component: number,
) =>
  readsStored(geometry, attribute)
    ? attribute.stored(index, component)
    : attribute.getComponent(index, component)

/** The positions as a list of numbers, three a vertex, at their values: the list itself when its
 *  numbers are (`plainPoints`), else a copy read vertex by vertex (`pointAt`); none without an
 *  attribute. */
export function readPoints(attribute: VertexAttribute | undefined): ArrayLike<number> {
  if (!attribute) return []
  const plain = plainPoints(attribute)
  if (plain) return plain.array
  const out = new Float32Array(attribute.count * 3)
  for (let i = 0; i < attribute.count; i++) out.set(pointAt(attribute, i, point), i * 3)
  return out
}
