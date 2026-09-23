import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFrames, NOT_DRAWN } from './worldFrames.ts';

test('the first frame after a pause spans at most two of the intervals the loop measured', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const frames = createWorldFrames();
  const deltas: number[] = [];
  frames.add((frame) => deltas.push(frame.delta));
  for (const at of [1500, 1516, 1532]) {
    now = at;
    frames.dispatch({ ...NOT_DRAWN });
  }
  // The first frame spans nothing; the running loop's own interval is kept as measured.
  assert.deepEqual(deltas, [0, 0.016, 0.016]);
  now = 6532; // Five seconds of a still scene, or of a hidden tab.
  assert.equal(frames.delta(), 0.032);
  frames.dispatch({ ...NOT_DRAWN });
  assert.equal(deltas.at(-1), 0.032);
});
