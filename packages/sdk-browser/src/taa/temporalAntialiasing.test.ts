import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { inertTaaDevice } from './device.fixture.ts';

// A convergence frame replays the last ordinary frame: every field the checkpoint keeps comes
// back, the sampled rank among them, so it draws the same lights and makes the same image.
test('the checkpoint keeps the frame fields the replay restores, sampled rank included', async () => {
  const temporal = await createTemporalAntialiasing(inertTaaDevice(), []);
  const { frame } = temporal;
  Object.assign(frame, {
    sample: 3,
    stillFrames: 0,
    hasHistory: true,
    sceneSeen: 7,
    sampledRank: 42,
  });
  frame.previousViewProjection.fill(0.5);
  temporal.checkpoint(false);
  Object.assign(frame, {
    sample: 4,
    stillFrames: 1,
    hasHistory: false,
    sceneSeen: 8,
    sampledRank: 0,
  });
  frame.previousViewProjection.fill(0);
  assert.equal(temporal.replay(), false, 'the replayed stillness is the checkpointed one');
  assert.deepEqual(
    [frame.sample, frame.stillFrames, frame.hasHistory, frame.sceneSeen, frame.sampledRank],
    [3, 0, true, 7, 42],
  );
  assert.ok(frame.previousViewProjection.every((value) => value === 0.5));
  temporal.dispose();
});
