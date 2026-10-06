import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  feedbackGeometryReady,
  orderCheckpoints,
  type ConvergenceFrame,
} from './feedbackConvergencePage.ts'

const frame = {
  frame: 0,
  held: false,
  coverageReady: true,
  selected: 10,
  drawn: 10,
  pagesLoading: 0,
  residentPages: 0,
  requested: 0,
  atLevel: 0,
  pending: 0,
  missingLevels: 0,
  refused: 0,
} satisfies ConvergenceFrame

test('WebGPU null uncovered count can still prove submitted geometry coverage', () => {
  assert.equal(feedbackGeometryReady(frame), true)
  assert.equal(feedbackGeometryReady({ ...frame, coverageReady: false }), false)
  assert.equal(feedbackGeometryReady({ ...frame, selected: 11 }), false)
  assert.equal(feedbackGeometryReady({ ...frame, pagesLoading: 1 }), false)
})

test('center-first order is checkpointed per surface kind, not only for the whole frame', () => {
  const count = (requested: number, atLevel: number) => ({ requested, atLevel })
  const region = (blendAt: number, opaqueAt: number) => ({
    ...count(80, blendAt + opaqueAt),
    pixels: 80,
    mips: {},
    kinds: { opaque: count(70, opaqueAt), mask: count(0, 0), blend: count(10, blendAt) },
  })
  const open = () => ({ centerFirst: null, peripheryAtLevel: null, present: false })
  const order = { all: open(), opaque: open(), mask: open(), blend: open() }
  orderCheckpoints(order, { center: region(10, 0), periphery: region(0, 0) }, 3)
  orderCheckpoints(order, { center: region(10, 70), periphery: region(10, 0) }, 5)
  orderCheckpoints(order, { center: region(10, 70), periphery: region(10, 70) }, 9)
  assert.deepEqual(order.blend, { centerFirst: 3, peripheryAtLevel: 5, present: false })
  assert.deepEqual(order.opaque, { centerFirst: 5, peripheryAtLevel: 9, present: false })
  assert.deepEqual(order.all, { centerFirst: 5, peripheryAtLevel: 9, present: false })
  assert.equal(order.mask.centerFirst, null)
})
