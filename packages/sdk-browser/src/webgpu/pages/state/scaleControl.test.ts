import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleControl } from './scaleControl.ts';

/** A display at 120 Hz, measured over a few frames. */
function at120(control: ReturnType<typeof createScaleControl>) {
  for (let frame = 0; frame < 4; frame++) control.tick((frame * 1000) / 120);
}

test('the controller follows the GPU time of images drawn at its own scale only', () => {
  const control = createScaleControl('auto');
  at120(control);
  assert.equal(control.wanted(), 1);
  control.observe(20, 1);
  const dropped = control.wanted();
  assert.ok(dropped < 1, 'a frame of 20 ms at 120 Hz drops the scale at once');
  control.observe(40, 1);
  assert.equal(control.wanted(), dropped, 'an image drawn before the change is discarded');
  control.observe(null, dropped);
  assert.equal(control.wanted(), dropped, 'an image without a time is discarded');
  control.observe(40, dropped, false);
  assert.equal(control.wanted(), dropped, 'a still image is discarded');
});

test('a fixed scale ignores the timings, and asking again restarts at the maximum', () => {
  const control = createScaleControl(0.7);
  at120(control);
  control.observe(40, 0.7);
  assert.equal(control.wanted(), 0.7);
  control.set({ min: 0.5, max: 0.9 });
  assert.deepEqual(control.bounds, { auto: true, min: 0.5, max: 0.9 });
  assert.equal(control.wanted(), 0.9);
});
