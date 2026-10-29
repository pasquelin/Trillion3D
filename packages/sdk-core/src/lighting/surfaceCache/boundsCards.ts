import type { MeshCard, MeshCards } from '../meshCardsFile.ts'
import type { Vec3 } from './cardTypes.ts'
import { directionVector } from './cardTypes.ts'

/**
 * THE CARDS OF A MESH THAT NO COMPILER BUILT, made from its bounds: a mesh a world cuts at run time has no `meshCards.bin`
 * row, so its box is covered by six cards, one for each axis-aligned direction (`directionVector`): the box seen along that
 * direction, `CARD_Z_OFFSET` deeper than it, its centre moved by the offset along the direction. A card's facing axis is its
 * direction; its second axis is the world axis square to it that is nearest to z (to x for a card facing z), and its first
 * is the facing axis crossed with the second, so that the first crossed with the second is the facing axis reversed. The half extents are the box's along the card's
 * own axes. A mesh made so is mostly two-sided: a hit on its cards is accepted though it matches the surface badly
 * (`MeshCards.mostlyTwoSided`).
 */

/** How much deeper than the bounds every card is made, and how far forward its centre is moved, in metres. */
const CARD_Z_OFFSET = 0.05

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const by = (f: (axis: number) => number): Vec3 => [f(0), f(1), f(2)]

/** The first and second axes of a card facing `z`. */
function cardAxes(z: Vec3): { x: Vec3; y: Vec3 } {
  const faces = Math.abs(z[2]) > Math.abs(z[0]) && Math.abs(z[2]) > Math.abs(z[1])
  // The world axis the second axis is made from, taken square to the facing axis.
  const seed: Vec3 = faces ? [1, 0, 0] : [0, 0, 1]
  const along = dot(seed, z)
  const flat = by((k) => seed[k] - z[k] * along)
  const length = Math.hypot(...flat)
  const y = cross(
    by((k) => flat[k] / length),
    z,
  )
  return { x: cross(z, y), y }
}

/** The cards of the mesh `mesh` — a number of its own, negative where no compiled mesh's can be — whose bounds are `box` (six numbers flat, metres). */
export function meshCardsFromBounds(mesh: number, box: ArrayLike<number>): MeshCards {
  const min: Vec3 = [box[0], box[1], box[2]]
  const max: Vec3 = [box[3], box[4], box[5]]
  const centre = by((k) => (min[k] + max[k]) / 2)
  const half = by((k) => (max[k] - min[k]) / 2)
  const along = (axis: Vec3) => Math.abs(dot(axis, half))
  const cards: MeshCard[] = Array.from({ length: 6 }, (_, direction) => {
    const axisZ = directionVector(direction)
    const { x: axisX, y: axisY } = cardAxes(axisZ)
    return {
      origin: by((k) => centre[k] + CARD_Z_OFFSET * axisZ[k]),
      extent: [along(axisX), along(axisY), along(axisZ) + CARD_Z_OFFSET],
      axisX,
      axisY,
      axisZ,
      direction,
    }
  })
  return { mesh, hlodCell: false, mostlyTwoSided: true, min, max, cards }
}
