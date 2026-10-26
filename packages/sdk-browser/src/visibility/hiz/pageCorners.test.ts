// The world corners are derived on every read instead of kept per page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxCornersInto } from '../../../../math/src/geometry/box.ts'
import { BOX_CORNER_VALUES, pageCornersInto } from './corners.ts'

// A dynamic geometry's vertices move up to its root's reach from where its pages are
// bounded. The corners an occlusion test reads hold that reach on every side — a page whose rest
// box hides behind an occluder while its moved triangles show past it is never rejected — and a
// root that never moved reads the rest box's doubles, bit for bit.
test('the corners grow by the root reach; without one, they are the rest box', () => {
  const page = { min: [-1, 2, -3], max: [4, 2.5, 1] },
    world = { elements: Float64Array.of(2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, -5, 1) }
  const rest = new Float64Array(BOX_CORNER_VALUES),
    still = new Float64Array(BOX_CORNER_VALUES),
    grown = new Float64Array(BOX_CORNER_VALUES),
    expected = new Float64Array(BOX_CORNER_VALUES)
  boxCornersInto(rest, 0, -1, 2, -3, 4, 2.5, 1, world.elements)
  pageCornersInto(still, 0, page, world)
  assert.deepEqual(still, rest)
  pageCornersInto(grown, 0, page, world, 1.5)
  boxCornersInto(expected, 0, -2.5, 0.5, -4.5, 5.5, 4, 2.5, world.elements)
  assert.deepEqual(grown, expected)
})
