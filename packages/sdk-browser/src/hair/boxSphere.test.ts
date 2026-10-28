// The bounds a groom is gathered by: a box and a sphere about one centre, grown, joined and carried
// by a matrix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxSphereOf, expandInto, maximumAxisScale, transformBox, unionInto } from './boxSphere.ts'
import { copyBoxSphere } from './boxSphere.fixture.ts'

const near = (a: ArrayLike<number>, b: ArrayLike<number>, why: string) => {
  assert.equal(a.length, b.length, why)
  for (let k = 0; k < a.length; k++) assert.ok(Math.abs(a[k]! - b[k]!) < 1e-12, `${why} [${k}]`)
}

/** A quarter turn about z, scaled by 2 along x, carried by (10, 0, -3): column-major. */
const MATRIX = [0, 2, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 0, -3, 1]

test('the sphere of a box goes through its corners, and a growth widens both by the same amount', () => {
  const bounds = boxSphereOf([-1, 0, 2, 3, 2, 4])
  near(bounds.sphere, [1, 1, 3, Math.sqrt(6)], 'sphere')
  const grown = boxSphereOf([0, 0, 0, 0, 0, 0])
  expandInto(grown, bounds, 0.5)
  near(grown.box, [-1.5, -0.5, 1.5, 3.5, 2.5, 4.5], 'grown box')
  near(grown.sphere, [1, 1, 3, Math.sqrt(6) + 0.5], 'grown sphere')
})

test('a matrix carries the box to the box of its eight corners', () => {
  const box = [-1, 0, 2, 3, 2, 4]
  const moved = transformBox(box, MATRIX)
  const corners = Array.from({ length: 8 }, (_, k) => {
    const [x, y, z] = [k & 1 ? 3 : -1, k & 2 ? 2 : 0, k & 4 ? 4 : 2]
    return [
      MATRIX[0]! * x + MATRIX[4]! * y + MATRIX[8]! * z + MATRIX[12]!,
      MATRIX[1]! * x + MATRIX[5]! * y + MATRIX[9]! * z + MATRIX[13]!,
      MATRIX[2]! * x + MATRIX[6]! * y + MATRIX[10]! * z + MATRIX[14]!,
    ]
  })
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(moved[axis]! - Math.min(...corners.map((c) => c[axis]!))) < 1e-12)
    assert.ok(Math.abs(moved[3 + axis]! - Math.max(...corners.map((c) => c[axis]!))) < 1e-12)
  }
})

test('a joined volume holds both, its sphere no larger than the one through its corners', () => {
  const a = boxSphereOf([0, 0, 0, 2, 2, 2]),
    b = boxSphereOf([4, 0, 0, 6, 2, 2])
  const joined = copyBoxSphere(a)
  unionInto(joined, a, b)
  near(joined.box, [0, 0, 0, 6, 2, 2], 'box')
  // The corners' sphere, √11, is smaller than what reaches both parts' spheres, 2 + √3.
  assert.ok(Math.abs(joined.sphere[3]! - Math.sqrt(11)) < 1e-12)
  // A box that holds the other keeps its own sphere.
  const inner = boxSphereOf([0.5, 0.5, 0.5, 1.5, 1.5, 1.5])
  const holds = copyBoxSphere(a)
  unionInto(holds, a, inner)
  assert.ok(Math.abs(holds.sphere[3]! - a.sphere[3]!) < 1e-12)
  // The result may be either operand.
  const into = copyBoxSphere(b)
  unionInto(into, a, into)
  near(into.box, joined.box, 'box into the second')
  assert.ok(Math.abs(into.sphere[3]! - joined.sphere[3]!) < 1e-12)
})

test('the greatest axis scale is the longest axis column', () => {
  assert.equal(maximumAxisScale(MATRIX), 2)
})
