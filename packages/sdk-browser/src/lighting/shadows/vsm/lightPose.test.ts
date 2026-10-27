// A light's pose is kept once, per light, and says both things that read it (`vsmLightPose`): whether
// the light moved lately (`vsmMobilityAt`, the bias) and whether its entry's pages are stale
// (`VsmLightCache.updateLocal`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmLightCache } from './lightCache.ts'
import { vsmLightMobility, vsmLightPose, vsmMobilityAt, type VsmLightMove } from './mapSettings.ts'

test('a light moved at the frame it is first asked and when its pose differs, and is kept by the light', () => {
  const moves = new Map<string, VsmLightMove>()
  const first = vsmLightPose(moves, 'lamp', [1, 2, 3], 10)
  assert.deepEqual([first.movedAt, first.pose], [10, [1, 2, 3]])
  const still = vsmLightPose(moves, 'lamp', [1, 2, 3], 11)
  assert.deepEqual([still, still.movedAt], [first, 10], 'the same record')
  const moved = vsmLightPose(moves, 'lamp', [1, 2, 4], 12)
  assert.deepEqual([moved.movedAt, moved.pose], [12, [1, 2, 4]])
  assert.equal(vsmLightPose(moves, 'other', [1, 2, 4], 12).movedAt, 12, 'another light')
  // A second ask of the same frame (another view, a replan) still says it moved: `movedAt` is the frame.
  assert.equal(vsmLightPose(moves, 'lamp', [1, 2, 4], 12).movedAt, 12)
})

test('the mobility falls from 1 to 0 over the active frames after the move', () => {
  const moves = new Map<string, VsmLightMove>()
  const move = vsmLightPose(moves, 'lamp', [0], 5)
  assert.deepEqual(
    [5, 6, 7, 9].map((frame) => vsmMobilityAt(move, frame, 4)),
    [1, 0.75, 0.5, 0],
  )
  assert.equal(vsmLightMobility(moves, 'lamp', [0], 7, 4), 0.5, 'the same ask, in one call')
  assert.equal(vsmLightMobility(moves, 'lamp', [1], 7, 4), 1, 'moved: back to 1')
})

test('an entry is stale when its light moved or stopped being distant, not for a light that stands', () => {
  const entry = new VsmLightCache('lamp', 6)
  // Its first frames: drawn uncached, then cached (a transition invalidates once).
  entry.updateLocal(true, false, false, false)
  entry.markRendered(1)
  entry.updateLocal(false, false, false, false)
  entry.markRendered(2)
  entry.updateLocal(false, false, false, false)
  assert.equal(entry.isInvalidated(), false, 'a light that stands keeps its pages')
  entry.updateLocal(true, false, false, false)
  assert.equal(entry.isInvalidated(), true, 'a light that moved')
  entry.markRendered(3)
  entry.updateLocal(false, true, false, false)
  assert.equal(entry.isInvalidated(), true, 'a light that became distant')
})
