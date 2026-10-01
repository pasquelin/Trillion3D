import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterEye } from './characterEye.ts';
import { HUMAN_BODY, RUN_CADENCE } from './characterSettings.ts';

const JOG = [HUMAN_BODY.walkSpeed, 0, 0],
  REST = [0, 0, 0];

/** The offsets of `seconds` lived in frames of `frame` seconds at `velocity`. */
function offsets(
  eye: ReturnType<typeof createCharacterEye>,
  seconds: number,
  velocity: number[],
  frame = 1 / 240,
) {
  const seen: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += frame) seen.push(eye.offset(frame, velocity, true));
  return seen;
}

test('a jog bobs the eye by headBob, once a step, and a stop leaves it level', () => {
  const eye = createCharacterEye(HUMAN_BODY);
  const seen = offsets(eye, 2, JOG);
  assert.ok(Math.abs(Math.max(...seen) - HUMAN_BODY.headBob) < 1e-4);
  assert.ok(Math.abs(Math.min(...seen) + HUMAN_BODY.headBob) < 1e-4);
  // One low point per step, at each foot strike after the first: 2 s hold 5 of them.
  const lows = seen.filter(
    (y, i) => i > 0 && i + 1 < seen.length && y < seen[i - 1] && y <= seen[i + 1],
  );
  assert.equal(lows.length, Math.floor(2 * RUN_CADENCE));
  assert.ok(offsets(eye, 0.1, REST).every((y) => y === 0));
});

test('a landing dips the eye impact × landingDip / e, then it settles to exactly 0', () => {
  const eye = createCharacterEye(HUMAN_BODY);
  eye.land(4);
  const seen = offsets(eye, 1, REST, 1 / 1000);
  const low = Math.min(...seen),
    at = (seen.indexOf(low) + 1) / 1000;
  assert.ok(Math.abs(low + (4 * HUMAN_BODY.landingDip) / Math.E) < 1e-4, `dip ${low}`);
  assert.ok(Math.abs(at - HUMAN_BODY.landingDip) < 2e-3, `lowest at ${at} s`);
  assert.ok(
    seen.every((y) => y <= 0),
    'no overshoot',
  );
  assert.equal(seen.at(-1), 0);
  // The knees bend and straighten smoothly: never faster than the 4 m/s of the impact, so no
  // frame of a millisecond moves the eye more than 4 mm.
  seen.forEach((y, i) => assert.ok(i === 0 || Math.abs(y - seen[i - 1]) <= 4e-3, `jump at ${i}`));
});

test('headBob and landingDip at 0 keep the eye level', () => {
  const eye = createCharacterEye({ ...HUMAN_BODY, headBob: 0, landingDip: 0 });
  eye.land(8);
  assert.ok(offsets(eye, 1, JOG).every((y) => y === 0));
});

test('stride follows horizontal pace, freezes in flight, and a zero walking speed disables bob', () => {
  const full = createCharacterEye(HUMAN_BODY),
    half = createCharacterEye(HUMAN_BODY);
  full.offset(0.1, [0, 0, HUMAN_BODY.walkSpeed], true);
  half.offset(0.1, [0, 0, HUMAN_BODY.walkSpeed / 2], true);
  assert.ok(full.stride > 0);
  assert.ok(Math.abs(full.stride - 2 * half.stride) < 1e-12);
  const phase = full.stride;
  full.offset(0.2, [3, 0, 4], false);
  assert.equal(full.stride, phase);
  const stopped = createCharacterEye({ ...HUMAN_BODY, walkSpeed: 0 });
  assert.ok(stopped.offset(0.1, [3, 0, 4], true) === 0);
  assert.equal(stopped.stride, 0);
});

test('landing recoil survives a zero-time frame and a live disabled setting clears it', () => {
  const settings = { ...HUMAN_BODY };
  const eye = createCharacterEye(settings);
  eye.land(3);
  assert.ok(eye.offset(0, [0, 0, 0], true) === 0);
  assert.ok(eye.offset(0.03, [0, 0, 0], true) < 0);
  settings.landingDip = 0;
  assert.ok(eye.offset(0, [0, 0, 0], true) === 0);
  settings.landingDip = HUMAN_BODY.landingDip;
  assert.ok(eye.offset(0.03, [0, 0, 0], true) === 0);
});

test('a landing made while landingDip is 0 is not dipped once it is set again', () => {
  const settings = { ...HUMAN_BODY, landingDip: 0 };
  const eye = createCharacterEye(settings);
  eye.land(3);
  settings.landingDip = HUMAN_BODY.landingDip;
  assert.ok(offsets(eye, 0.5, REST).every((y) => y === 0));
});
