// The world corners are derived on every read instead of kept per page (#18): the doubles must be
// those the former per-page table held, bit for bit, before and after a model moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxCornersInto } from '../../../sdk-core/src/index.ts'
import { BOX_CORNER_VALUES, pageCornersInto, type HizPage } from './hiz.ts'

/** A page and the world its root places it by. */
type Placed = HizPage & { matrix: { elements: Float64Array } }

/** The former table, as `createBoxCorners` held it: filled on an epoch change, read otherwise. */
function keptTable(pages: Placed[]) {
  const corners = new Float64Array(pages.length * BOX_CORNER_VALUES),
    epoch = new Int32Array(pages.length)
  return {
    epoch,
    at(index: number, value: number) {
      const base = index * BOX_CORNER_VALUES,
        { min, max } = pages[index]
      if (epoch[index] !== value) {
        const m = pages[index].matrix.elements
        boxCornersInto(corners, base, min[0], min[1], min[2], max[0], max[1], max[2], m)
        epoch[index] = value
      }
      return corners.subarray(base, base + BOX_CORNER_VALUES)
    },
  }
}

test('derived world corners are the former kept doubles, bit for bit, across a move', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1
  const pages: Placed[] = Array.from({ length: 64 }, () => {
    const low = [rnd() * 1e4, rnd() * 50, rnd() * 1e4]
    // A sheared, far-translated world with a small projective row: every term of the divide counts.
    const elements = Float64Array.from(
      { length: 16 },
      (_, k) => (k % 5 === 0 ? 1 : 0) + rnd() * 0.3,
    )
    elements.set([rnd() * 1e5, rnd() * 10, rnd() * 1e5, 1], 12)
    for (const k of [3, 7, 11]) elements[k] = rnd() * 1e-6
    return {
      min: low,
      max: low.map((v) => v + Math.abs(rnd()) * 3 + 1e-3),
      matrix: { elements },
    }
  })
  const kept = keptTable(pages),
    derived = new Float64Array(BOX_CORNER_VALUES)
  const same = (label: string) => {
    for (let i = 0; i < pages.length; i++) {
      pageCornersInto(derived, 0, pages[i], pages[i].matrix)
      const reference = kept.at(i, 1)
      for (let k = 0; k < BOX_CORNER_VALUES; k++)
        assert.ok(Object.is(derived[k], reference[k]), `${label}: page ${i}, value ${k}`)
    }
  }
  same('first image')
  same('an image that read the table')
  // A moved model: its world changes and the former table forgot its corners.
  for (let i = 0; i < 8; i++) {
    pages[i].matrix.elements[12] += 123.456
    kept.epoch[i] = -1
  }
  same('after a move')
})

// #573: a dynamic geometry's vertices move up to its root's reach from where its pages are
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
