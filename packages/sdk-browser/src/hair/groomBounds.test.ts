// The bounds of a groom: the groups' boxes taken one after the other, each time widened by the strands' width,
// then carried to the world.
import test from 'node:test'
import assert from 'node:assert/strict'
import { groomBounds } from './groomBounds.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const FIRST = { boundsMin: [0, 0, 0], boundsMax: [1, 1, 1], maxRadius: 0.1 }
const SECOND = { boundsMin: [5, 0, 0], boundsMax: [6, 1, 1], maxRadius: 0.4 }

const near = (a: ArrayLike<number>, b: readonly number[]) => {
  for (let k = 0; k < b.length; k++)
    assert.ok(Math.abs(a[k]! - b[k]!) < 1e-12, `${Array.from(a)} ≠ ${b}`)
}

test('the box so far is widened again by each group: the borders of the groups before add up', () => {
  const { box } = groomBounds([FIRST, SECOND], IDENTITY)
  // After the first group the box is 0…1 widened by 0.1; the second joins it and widens all by 0.4.
  near(box, [-0.5, -0.5, -0.5, 6.4, 1.5, 1.5])
})

test('a scaling gives the widening back: the strands keep their width', () => {
  const scaled = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 0, 1]
  const { box } = groomBounds([FIRST], scaled)
  // The box (0…1) scaled by 2 and carried by 10, plus the radius 0.1 once, in the world.
  near(box, [9.9, -0.1, -0.1, 12.1, 2.1, 2.1])
})
