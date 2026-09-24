import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, driveTick, gripOf } from './characterDrive.ts';
import { HUMAN_BODY, type CharacterSettings } from './characterSettings.ts';
import { PHYSICS_MATERIALS } from '../physics/options.ts';

const STILL = { wishX: 0, wishZ: 0, sprint: false },
  EAST = { wishX: 1, wishZ: 0, sprint: false };

/** A grounded drive on a floor of friction `floor`, jogging east at `speed`. */
function jogging(floor: number, speed = HUMAN_BODY.walkSpeed) {
  const drive = createDrive();
  drive.floor = floor;
  drive.velocity[0] = speed;
  return drive;
}

/** Lives ticks of `h` seconds under `input` for `seconds`; returns the distance moved east. */
function run(
  drive: ReturnType<typeof createDrive>,
  input: typeof STILL,
  seconds: number,
  h = 1 / 120,
  settings: CharacterSettings = HUMAN_BODY,
) {
  const step = { dx: 0, dz: 0, jumped: false };
  let x = 0;
  for (let t = 0; t < seconds - 1e-9; t += h)
    if (driveTick(drive, settings, input, h, false, {}, step)) x += step.dx;
  return x;
}

const { stone, ice } = PHYSICS_MATERIALS,
  v = HUMAN_BODY.walkSpeed,
  g = HUMAN_BODY.gravity,
  rate = -Math.log(0.05) / HUMAN_BODY.stopTime;

test('a jog glides v² / (2 μ g) to a stop, longer on ice than on stone', () => {
  const glides = [stone, ice].map(({ friction }) => {
    const push = gripOf(friction) * g,
      expected = (v * v) / (2 * push),
      glide = run(jogging(friction), STILL, 10);
    // The legs' exponential closes the last push / rate: at most push / rate² more.
    assert.ok(
      glide >= expected - 1e-6 && glide <= expected + push / rate ** 2,
      `glide ${glide} m, expected ${expected} m on friction ${friction}`,
    );
    return glide;
  });
  assert.ok(glides[1] > 4 * glides[0], `ice ${glides[1]} m, stone ${glides[0]} m`);
});

test('the start is bounded the same way: μ g from rest', () => {
  for (const { friction } of [stone, ice]) {
    const drive = jogging(friction, 0);
    run(drive, EAST, 0.1);
    const expected = gripOf(friction) * g * 0.1;
    assert.ok(Math.abs(drive.velocity[0] - expected) < 1e-9, `${drive.velocity[0]} m/s`);
  }
});

test('a stop is the same whatever the tick', () => {
  const fine = run(jogging(ice.friction), STILL, 10, 1 / 240),
    coarse = run(jogging(ice.friction), STILL, 10, 1 / 30);
  // Within the 0.1 mm of glide left when the body is set at rest, read at the end of a tick.
  assert.ok(Math.abs(fine - coarse) < 1e-4, `${fine} m and ${coarse} m`);
});

test('an explicit stopTime gentler than the floor wins', () => {
  // 2 s: the legs ask v / 0.67 s = 5.2 m/s², under stone's 7.8 m/s²: a pure exponential, v / rate.
  const settings = { ...HUMAN_BODY, stopTime: 2 },
    glide = run(jogging(stone.friction), STILL, 30, 1 / 120, settings);
  const expected = (v * 2) / -Math.log(0.05);
  assert.ok(Math.abs(glide - expected) < 1e-3, `glide ${glide} m, expected ${expected} m`);
});
