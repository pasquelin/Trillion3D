// The periodic reset of the surface cache falls every Nth image, and never on the first: image 0 is a new view, not a multiple.
import test from 'node:test'
import assert from 'node:assert/strict'
import { periodicResetDue } from './periodicReset.ts'

test('the periodic reset is due on every Nth image but the first, and never when switched off', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((frame) => periodicResetDue(frame, 2)),
    [false, false, true, false, true],
  )
  assert.equal(periodicResetDue(0, 1), false, 'the first image is no reset')
  assert.equal(periodicResetDue(7, 0), false, 'switched off')
})
