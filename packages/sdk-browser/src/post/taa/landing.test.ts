// Only what the history no longer describes — a view cut, new targets, the pass switched — drops
// it, the jitter back to phase zero, as a camera cut restarts the sample sequence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dropTaaHistory } from './landing.ts'
import { createTaaFrameState } from './frameState.ts'

test('a dropped history restarts the jitter at phase zero', () => {
  const frame = Object.assign(createTaaFrameState(), { sample: 3, hasHistory: true })
  dropTaaHistory(frame)
  assert.deepEqual([frame.sample, frame.hasHistory], [0, false])
})

test('a view without the pass has nothing to drop', () => {
  assert.doesNotThrow(() => dropTaaHistory(undefined))
})
