import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, driveTick } from './characterDrive.ts';
import { HUMAN_BODY, SOLE_FRICTION } from './characterSettings.ts';

const still = { wishX: 0, wishZ: 0, sprint: false };

test('an expired coyote window rejects a fresh press and an expired press is not revived by landing', () => {
  for (const expired of ['coyote', 'buffer']) {
    const drive = createDrive();
    drive.grounded = expired === 'buffer';
    drive.sinceGround = expired === 'coyote' ? HUMAN_BODY.coyoteTime : 0;
    drive.sinceJump = expired === 'buffer' ? HUMAN_BODY.jumpBuffer : 0;
    const step = { dx: 0, dz: 0, jumped: false };
    let jumps = 0;
    driveTick(drive, HUMAN_BODY, still, 0.01, true, { onJump: () => jumps++ }, step);
    assert.equal(step.jumped, false, expired);
    assert.equal(jumps, 0, expired);
    assert.equal(drive.velocity[1], 0);
  }
});

test('a drive that rests reports that no tick movement is required', () => {
  const drive = createDrive();
  assert.equal(
    driveTick(drive, HUMAN_BODY, still, 1 / 120, false, {}, { dx: 0, dz: 0, jumped: false }),
    false,
  );
});

test('only unsteered grounded motion is snapped to rest inside the declared tenth-millimetre glide', () => {
  const settings = { ...HUMAN_BODY, stopTime: -Math.log(0.05) / 2 };
  for (const velocity of [0.000199, 0.0002, 0.000201]) {
    const drive = createDrive();
    drive.velocity[0] = velocity;
    driveTick(drive, settings, still, 0, false, {}, { dx: 0, dz: 0, jumped: false });
    assert.equal(drive.velocity[0], velocity < 0.0002 ? 0 : velocity);
  }
  for (const grounded of [false, true]) {
    const drive = createDrive();
    drive.grounded = grounded;
    drive.velocity[2] = 1e-5;
    driveTick(
      drive,
      settings,
      { ...still, wishZ: 1 },
      0,
      false,
      {},
      { dx: 0, dz: 0, jumped: false },
    );
    assert.ok(drive.velocity[2] > 0, 'a held direction is never snapped to rest');
  }
});

test('a coarse braking tick crosses from friction-limited deceleration into exponential settling', () => {
  const drive = createDrive();
  drive.floor = 1 / SOLE_FRICTION;
  drive.velocity[0] = 4;
  // With unit combined grip, 2m/s² braking reaches 2m/s after one second,
  // then a one-second response constant leaves 2/e after the next second.
  const settings = { ...HUMAN_BODY, gravity: 2, stopTime: -Math.log(0.05) };
  const step = { dx: 0, dz: 0, jumped: false };
  driveTick(drive, settings, still, 2, false, {}, step);
  assert.ok(Math.abs(drive.velocity[0] - 2 / Math.E) < 1e-12);
  assert.ok(Math.abs(step.dx - (5 - 2 / Math.E)) < 1e-12);
});
