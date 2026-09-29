// The feedback word a pass reads (`phaseWord`): the pick turn rides above the phase and the
// "every pixel" bit, on every image (#1016).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_EVERY, PICK_CYCLE, PICK_SHIFT, createWebgpuTileFeedback } from './feedback.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

// #1016 review: ordinary images never turned the pick, so a live view never asked the sliver's
// tile. Each pixel speaks once per phase round: the pick turns once per round, and each pixel
// steps through every pick as it speaks. A convergence image names every pick itself.
test('ordinary images turn the pick once per whole phase round', () => {
  const feedback = createWebgpuTileFeedback(fakeDevice().device, 4);
  const picks = new Set<number>();
  for (let image = 0; image < FEEDBACK_EVERY * PICK_CYCLE; image++) {
    const word = feedback.phaseWord(false);
    if ((word & (FEEDBACK_EVERY - 1)) === 5) picks.add(word >> PICK_SHIFT);
    assert.equal(word & FEEDBACK_EVERY, 0);
    assert.equal(feedback.phaseWord(true), word | FEEDBACK_EVERY);
    feedback.submitted();
  }
  assert.equal(picks.size, PICK_CYCLE, 'one pixel of the square named every pick');
});
