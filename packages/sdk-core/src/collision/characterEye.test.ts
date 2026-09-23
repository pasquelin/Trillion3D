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
});

test('headBob and landingDip at 0 keep the eye level', () => {
  const eye = createCharacterEye({ ...HUMAN_BODY, headBob: 0, landingDip: 0 });
  eye.land(8);
  assert.ok(offsets(eye, 1, JOG).every((y) => y === 0));
});
