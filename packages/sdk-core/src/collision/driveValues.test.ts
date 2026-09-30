import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, driveTick, driveAtRest } from './characterDrive.ts';
import { createCharacterEye } from './characterEye.ts';
import { HUMAN_BODY } from './characterSettings.ts';
const still = { wishX: 0, wishZ: 0, sprint: false };

test('rest requires no horizontal key or velocity on either axis and a grounded body', () => {
  const drive = createDrive();
  assert.equal(driveAtRest(drive, still), true);
  for (const key of ['wishX', 'wishZ'])
    assert.equal(driveAtRest(drive, { ...still, [key]: 1 }), false);
  for (const axis of [0, 2]) {
    drive.velocity[axis] = 1;
    assert.equal(driveAtRest(drive, still), false);
    drive.velocity[axis] = 0;
  }
  drive.grounded = false;
  assert.equal(driveAtRest(drive, still), false);
});
test('buffered and coyote jumps include the exact deadline, expire afterward and consume the press', () => {
  for (const expired of [false, true]) {
    const drive = createDrive();
    drive.grounded = false;
    drive.sinceGround = HUMAN_BODY.coyoteTime;
    drive.sinceJump = HUMAN_BODY.jumpBuffer;
    const step = { dx: 99, dz: 99, jumped: false };
    let jumps = 0;
    driveTick(drive, HUMAN_BODY, still, expired ? 0.001 : 0, true, { onJump: () => jumps++ }, step);
    assert.equal(step.jumped, !expired);
    assert.equal(jumps, expired ? 0 : 1);
    if (!expired) {
      assert.equal(drive.velocity[1], HUMAN_BODY.jumpSpeed);
      assert.equal(drive.sinceGround, Infinity);
      assert.equal(drive.sinceJump, Infinity);
    }
    driveTick(drive, HUMAN_BODY, still, 0, true, { onJump: () => jumps++ }, step);
    assert.equal(step.jumped, false);
    assert.equal(jumps, expired ? 0 : 1);
  }
});
test('air steering reaches 95 percent in its declared response time and unsteered motion keeps momentum', () => {
  const settings = { ...HUMAN_BODY, walkSpeed: 4, responseTime: 0.2, airControl: 0.25 };
  const drive = createDrive();
  drive.grounded = false;
  const step = { dx: 0, dz: 0, jumped: false };
  driveTick(drive, settings, { ...still, wishZ: 1 }, 0.8, false, {}, step);
  assert.ok(Math.abs(drive.velocity[2] - 3.8) < 1e-12);
  assert.equal(drive.velocity[0], 0);
  drive.velocity.set([3, 2, -4]);
  driveTick(drive, settings, still, 0.2, false, {}, step);
  assert.deepEqual([...drive.velocity], [3, 2, -4]);
  assert.ok(Math.abs(step.dx - 0.6) < 1e-12);
  assert.ok(Math.abs(step.dz + 0.8) < 1e-12);
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
  eye.land(0.01);
  assert.ok(eye.offset(0, [0, 0, 0], true) === 0);
  assert.ok(eye.offset(0.03, [0, 0, 0], true) < -1e-5);
  settings.landingDip = 0;
  assert.ok(eye.offset(0, [0, 0, 0], true) === 0);
  settings.landingDip = 0.06;
  assert.ok(eye.offset(0.03, [0, 0, 0], true) === 0);
});
