import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, driveAtRest, driveTick } from './characterDrive.ts';
import {
  HUMAN_BODY,
  RESPONSE_LEFT,
  REST_GLIDE,
  type CharacterSettings,
} from './characterSettings.ts';
import { PHYSICS_MATERIALS } from '../physics/options.ts';
import { gripOf } from './grip.ts';

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
  rate = -Math.log(RESPONSE_LEFT) / HUMAN_BODY.stopTime;

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
  const expected = (v * 2) / -Math.log(RESPONSE_LEFT);
  assert.ok(Math.abs(glide - expected) < 1e-3, `glide ${glide} m, expected ${expected} m`);
});

test('rest requires no horizontal key or velocity on either axis and a grounded body', () => {
  const drive = createDrive();
  assert.equal(driveAtRest(drive, STILL), true);
  for (const key of ['wishX', 'wishZ'])
    assert.equal(driveAtRest(drive, { ...STILL, [key]: 1 }), false);
  for (const axis of [0, 2]) {
    drive.velocity[axis] = 1;
    assert.equal(driveAtRest(drive, STILL), false);
    drive.velocity[axis] = 0;
  }
  drive.grounded = false;
  assert.equal(driveAtRest(drive, STILL), false);
});

test('buffered and coyote jumps include the exact deadline, expire afterward and consume the press', () => {
  for (const expired of [false, true]) {
    const drive = createDrive();
    drive.grounded = false;
    drive.sinceGround = HUMAN_BODY.coyoteTime;
    drive.sinceJump = HUMAN_BODY.jumpBuffer;
    const step = { dx: 99, dz: 99, jumped: false };
    let jumps = 0;
    driveTick(drive, HUMAN_BODY, STILL, expired ? 0.001 : 0, true, { onJump: () => jumps++ }, step);
    assert.equal(step.jumped, !expired);
    assert.equal(jumps, expired ? 0 : 1);
    if (!expired) {
      assert.equal(drive.velocity[1], HUMAN_BODY.jumpSpeed);
      assert.equal(drive.sinceGround, Infinity);
      assert.equal(drive.sinceJump, Infinity);
    }
    driveTick(drive, HUMAN_BODY, STILL, 0, true, { onJump: () => jumps++ }, step);
    assert.equal(step.jumped, false);
    assert.equal(jumps, expired ? 0 : 1);
  }
});

test('air steering reaches 95 percent in its declared response time and unsteered motion keeps momentum', () => {
  const settings = { ...HUMAN_BODY, walkSpeed: 4, responseTime: 0.2, airControl: 0.25 };
  const drive = createDrive();
  drive.grounded = false;
  const step = { dx: 0, dz: 0, jumped: false };
  driveTick(drive, settings, { ...STILL, wishZ: 1 }, 0.8, false, {}, step);
  assert.ok(Math.abs(drive.velocity[2] - 3.8) < 1e-12);
  assert.equal(drive.velocity[0], 0);
  drive.velocity.set([3, 2, -4]);
  driveTick(drive, settings, STILL, 0.2, false, {}, step);
  assert.deepEqual([...drive.velocity], [3, 2, -4]);
  assert.ok(Math.abs(step.dx - 0.6) < 1e-12);
  assert.ok(Math.abs(step.dz + 0.8) < 1e-12);
});

test('an expired coyote window rejects a fresh press and an expired press is not revived by landing', () => {
  for (const expired of ['coyote', 'buffer']) {
    const drive = createDrive();
    drive.grounded = expired === 'buffer';
    drive.sinceGround = expired === 'coyote' ? HUMAN_BODY.coyoteTime : 0;
    drive.sinceJump = expired === 'buffer' ? HUMAN_BODY.jumpBuffer : 0;
    const step = { dx: 0, dz: 0, jumped: false };
    let jumps = 0;
    driveTick(drive, HUMAN_BODY, STILL, 0.01, true, { onJump: () => jumps++ }, step);
    assert.equal(step.jumped, false, expired);
    assert.equal(jumps, 0, expired);
    assert.equal(drive.velocity[1], 0);
  }
});

test('a drive that rests reports that no tick movement is required', () => {
  const drive = createDrive();
  assert.equal(
    driveTick(drive, HUMAN_BODY, STILL, 1 / 120, false, {}, { dx: 0, dz: 0, jumped: false }),
    false,
  );
});

test('with no key, a grounded glide shorter than REST_GLIDE stops dead; a held key never does', () => {
  // The legs' braking rate is 2 a second: a speed v has v / 2 m of glide left.
  const rate = 2,
    settings = { ...HUMAN_BODY, stopTime: -Math.log(RESPONSE_LEFT) / rate },
    limit = REST_GLIDE * rate;
  for (const [velocity, stops] of [
    [limit * 0.99, true],
    [limit, false],
    [limit * 1.01, false],
  ] as const) {
    const drive = createDrive();
    drive.velocity[0] = velocity;
    driveTick(drive, settings, STILL, 0, false, {}, { dx: 0, dz: 0, jumped: false });
    assert.equal(drive.velocity[0], stops ? 0 : velocity);
  }
  for (const grounded of [false, true]) {
    const drive = createDrive();
    drive.grounded = grounded;
    drive.velocity[2] = limit / 10;
    const north = { ...STILL, wishZ: 1 };
    driveTick(drive, settings, north, 0, false, {}, { dx: 0, dz: 0, jumped: false });
    assert.ok(drive.velocity[2] > 0, 'a held direction is never snapped to rest');
  }
});

test('a long braking tick is the floor-limited push, then the exponential, in one closed form', () => {
  const drive = createDrive();
  drive.velocity[0] = 4;
  // The floor brakes at 2 m/s² down to push / rate = 2 m/s, one second; the legs' rate of 1 a
  // second then leaves 2 / e after the next second.
  const settings = {
    ...HUMAN_BODY,
    gravity: 2 / gripOf(drive.floor),
    stopTime: -Math.log(RESPONSE_LEFT),
  };
  const step = { dx: 0, dz: 0, jumped: false };
  driveTick(drive, settings, STILL, 2, false, {}, step);
  assert.ok(Math.abs(drive.velocity[0] - 2 / Math.E) < 1e-12);
  // 3 m in the first second, then 2 (1 - 1 / e) m.
  assert.ok(Math.abs(step.dx - (5 - 2 / Math.E)) < 1e-12);
});
