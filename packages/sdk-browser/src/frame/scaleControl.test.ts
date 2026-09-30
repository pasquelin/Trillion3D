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
  assert.equal(control.wanted(), dropped, 'an unsteered image is discarded');
});

test('a GPU time arriving late steps by the stillness of the image it measured', () => {
  const control = createScaleControl('auto');
  at120(control);
  control.observe(20, 1);
  const dropped = control.wanted();
  // The last image is a moving one; the times arriving are of still images, on time.
  control.drew(dropped, true, false);
  for (let frame = 0; frame < 120; frame++) control.observe(2, dropped, true, true);
  assert.equal(control.wanted(), dropped, 'a still image never raises the scale');
  for (let frame = 0; frame < 120; frame++) control.observe(2, dropped);
  assert.ok(control.wanted() > dropped, 'moving images on time raise it');
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

// #1343: without `timestamp-query` the controller never moved, and a still image never stepped it.
test('without GPU times the frame interval drops the scale, a still frame included', () => {
  const control = createScaleControl('auto');
  let now = 0;
  const frame = (gap: number, still: boolean, timed = false) => {
    control.drew(control.wanted(), true, still);
    control.tick((now += gap), timed);
  };
  for (let i = 0; i < 4; i++) control.tick((now += 1000 / 120));
  frame(30, true);
  const dropped = control.wanted();
  assert.ok(dropped < 1, 'a still frame of 30 ms at 120 Hz drops the scale at once');
  for (let i = 0; i < 60; i++) frame(1000 / 120, true);
  assert.equal(control.wanted(), dropped, 'still frames on time never raise it');
  frame(1000 / 120, false);
  const raised = control.wanted();
  assert.ok(raised > dropped, 'a moving frame on time, after a run of them, tries a step up');
  frame(30, false, true);
  assert.equal(
    control.wanted(),
    raised,
    'where the GPU timer measures, the interval steps nothing',
  );
});

// #1343: a device that never met its cadence took its slow frames for the display's refresh.
test('without GPU times a device that never meets its cadence is measured against 60 Hz', () => {
  const control = createScaleControl('auto');
  let now = 0;
  for (let frame = 0; frame < 40; frame++) {
    control.drew(control.wanted(), true);
    control.tick((now += 50));
  }
  assert.equal(control.wanted(), 0.5, 'frames of 50 ms are over a 60 Hz budget');
});

// #1343: the targets follow the drawn size, without remaking them at each step around an eighth.
test('the targets grow at once to the next eighth and shrink only two eighths below', () => {
  const control = createScaleControl({ min: 0.5, max: 1 });
  let now = 0;
  for (let i = 0; i < 4; i++) control.tick((now += 1000 / 120));
  assert.equal(control.allocated(), 1);
  control.observe(12, 1);
  const drawn = control.wanted();
  assert.ok(drawn > 0.75 && drawn < 0.875);
  assert.equal(control.allocated(), 1, 'one eighth below: the targets stay');
  control.observe(40, drawn);
  assert.equal(control.wanted(), 0.5);
  assert.equal(control.allocated(), 0.5, 'far below: the targets shrink to the drawn size');
});
