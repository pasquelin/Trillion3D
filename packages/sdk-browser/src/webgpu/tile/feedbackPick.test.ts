// The feedback word a pass reads (`phaseWord`): a convergence carries its pick turn above the
// phase and the "every pixel" bit, a measured image carries its phase alone (#1016).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_EVERY, PICK_CYCLE, PICK_SHIFT, createWebgpuTileFeedback } from './feedback.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('only a convergence image turns the pick, one step per image, round the cycle', () => {
  const feedback = createWebgpuTileFeedback(fakeDevice().device, 4);
  assert.equal(feedback.phaseWord(true), FEEDBACK_EVERY);
  feedback.turnPick();
  assert.equal(feedback.phaseWord(true), FEEDBACK_EVERY | (1 << PICK_SHIFT));
  assert.equal(feedback.phaseWord(false), 0, 'a measured image names by position alone');
  for (let turn = 1; turn < PICK_CYCLE; turn++) feedback.turnPick();
  assert.equal(feedback.phaseWord(true), FEEDBACK_EVERY);
});
