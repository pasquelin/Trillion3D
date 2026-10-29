// A set kept while no light shadows (a frame at `shadowQuality` 0) writes what a frame of no map
// writes: it settles, counts nothing and holds no plan; a plan again waits for its counts again.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVsmSettle,
  landVsmStats,
  noteVsmFrame,
  noteVsmIdleFrame,
  stampVsmStats,
  vsmArrived,
  vsmUnsettled,
} from './vsmSettle.ts'
import type { VsmFramePlan } from '../../../lighting/shadows/vsm/frameSetup.ts'

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

/** A plan of one projection, its light cached or drawn uncached this frame (`uncached`). */
const planOf = (uncached = false) =>
  ({ uncachedDrawn: uncached, overflow: false, projectionCount: 1 }) as unknown as VsmFramePlan

test('casters that move invalidate pages every frame: the maps never settle, yet they arrive', () => {
  const settle = createVsmSettle()
  const staging = {} as GPUBuffer
  noteVsmFrame(settle, 1, planOf(true), 0, 0, true)
  assert.ok(!vsmArrived(settle, true), 'no count read back since the light was drawn uncached')
  for (let frame = 2; frame <= 6; frame++) {
    noteVsmFrame(settle, frame, planOf(), 3, 0, true)
    stampVsmStats(settle, staging, frame)
    landVsmStats(settle, staging, 4)
    assert.ok(vsmUnsettled(settle, true), `frame ${frame}: pages drawn after an invalidation`)
    assert.ok(
      vsmArrived(settle, true),
      `frame ${frame}: a count read back after the light was drawn`,
    )
  }
})

test('the maps arrive again after a cause other than an invalidation: the bias moved, a raster skipped', () => {
  const settle = createVsmSettle()
  const staging = {} as GPUBuffer
  noteVsmFrame(settle, 1, planOf(), 0, 0, true)
  stampVsmStats(settle, staging, 1)
  landVsmStats(settle, staging, 0)
  assert.ok(vsmArrived(settle, true))
  noteVsmFrame(settle, 2, planOf(), 0, 1, true)
  assert.ok(!vsmArrived(settle, true), 'the resolution bias moved')
  stampVsmStats(settle, staging, 2)
  landVsmStats(settle, staging, 5)
  assert.ok(vsmArrived(settle, true))
  noteVsmFrame(settle, 3, planOf(), 0, 1, false)
  assert.ok(!vsmArrived(settle, true), 'the raster was skipped')
})

test('without counters the maps arrive the frames a cause waits after the last cause other than an invalidation', () => {
  const settle = createVsmSettle()
  noteVsmFrame(settle, 1, planOf(true), 0, 0, true)
  let frame = 1
  while (!vsmArrived(settle, false)) noteVsmFrame(settle, ++frame, planOf(), 2, 0, true)
  assert.equal(frame, 1 + 4, 'four frames after the light was drawn uncached, whatever moved since')
})
