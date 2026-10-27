// A set kept while no light shadows (a frame at `shadowQuality` 0) writes what a frame of no map
// writes: it settles, counts nothing and holds no plan; a plan again waits for its counts again.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVsmSettle,
  landVsmStats,
  noteVsmIdleFrame,
  stampVsmStats,
  vsmUnsettled,
} from './vsmSettle.ts'

/** A settle whose last count read back says pages were drawn, after a cause at frame 3. */
function drawingSettle() {
  const settle = createVsmSettle()
  settle.causeFrame = 3
  settle.landedFrame = 5
  settle.landedRendered = 2
  settle.frame = 5
  return settle
}

test('a set with pages counted drawn is settled after an idle frame', () => {
  const settle = drawingSettle()
  assert.ok(vsmUnsettled(settle, true), 'the last count says pages were drawn')
  noteVsmIdleFrame(settle, 6)
  assert.ok(!vsmUnsettled(settle, true))
  assert.equal(settle.landedRendered, 0)
  assert.equal(settle.landedFrame, 6)
})

test('a count copy stamped before the idle frame leaves the set settled when it lands', () => {
  const settle = drawingSettle()
  const staging = {} as GPUBuffer
  stampVsmStats(settle, staging, 5)
  noteVsmIdleFrame(settle, 6)
  landVsmStats(settle, staging, 9)
  assert.ok(!vsmUnsettled(settle, true), 'the older copy is ignored')
  assert.equal(settle.landedRendered, 0)
  assert.equal(settle.renderedTotal, 9, 'the pages it drew are still counted in the version')
})

test('a plan again after the idle frames waits for its counts again', () => {
  const settle = drawingSettle()
  noteVsmIdleFrame(settle, 6)
  settle.causeFrame = 7
  assert.ok(vsmUnsettled(settle, true), 'a cause after the last count')
})

test('without counters a set settles once the idle frames pass the frames a cause waits', () => {
  const settle = drawingSettle()
  let frame = 5
  while (vsmUnsettled(settle, false)) noteVsmIdleFrame(settle, ++frame)
  assert.equal(frame, 3 + 4, 'four frames after the cause at 3, not at the first idle frame')
})
