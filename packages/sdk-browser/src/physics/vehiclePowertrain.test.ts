import test from 'node:test';
import assert from 'node:assert/strict';
import type { VehicleOptions } from '../../../sdk-core/src/physics/index.ts';
import { VEHICLE_SPECS } from '../../../sdk-core/src/physics/vehicleSpec.ts';
import { driveCar as drive, type VehicleRig as Rig } from './vehicles.fixture.ts';

// The engine and gearbox options of a car, set against its machine's own value on the committed
// module: each test fails if `vehicles.cpp` ignores the option or reads it at another word.

const CAR = VEHICLE_SPECS.car;
/** The car's wheel radius in the rig (`vehicles.fixture.ts`), m. */
const RADIUS = 0.33;
/** The speed at which the engine's redline turns the wheels through `ratio`, m/s. */
const redlineSpeed = (ratio: number) => (CAR.maxRPM / 60) * 2 * Math.PI * (RADIUS / ratio);

/** The steps a car of `options` takes to reach 10 m/s at full throttle. */
async function until10(options: Partial<VehicleOptions>) {
  let steps = 0;
  await drive(options, { throttle: 1 }, 5, (rig) => (steps += +(rig.vehicle.speed < 10)));
  return steps;
}

test('torquePerKg: half the torque reaches 10 m/s later', async () => {
  const [full, half] = [await until10({}), await until10({ torquePerKg: CAR.torquePerKg / 2 })];
  assert.ok(half > 1.2 * full, `${half} steps against ${full}`);
});

test('torqueCurve: a curve at 0.4 of the peak everywhere reaches 10 m/s later', async () => {
  const flat = [
    [0, 0.4],
    [1, 0.4],
  ] as const;
  const [own, low] = [await until10({}), await until10({ torqueCurve: flat })];
  assert.ok(low > 1.2 * own, `${low} steps against ${own}`);
});

test('idleRPM: standing still, the engine idles at its idle', async () => {
  const idling = async (idleRPM: number) => (await drive({ idleRPM }, {}, 1)).vehicle.rpm;
  const [own, fast] = [await idling(CAR.idleRPM), await idling(1500)];
  assert.ok(Math.abs(own - CAR.idleRPM) < 50, `own ${own}`);
  assert.ok(Math.abs(fast - 1500) < 50, `fast ${fast}`);
});

/** The speed at the first shift from `from` to `to`, m/s; -1 if none. */
function shiftSpeed(from: number, to: number) {
  let last = -1,
    speed = -1;
  const watch = (rig: Rig) => {
    if (speed < 0 && last === from && rig.vehicle.gear === to) speed = rig.vehicle.speed;
    last = rig.vehicle.gear;
  };
  return { watch, speed: () => speed };
}

test('shiftUpRPM: shifting up at 3,000 rpm leaves first gear at about half the speed', async () => {
  // Half throttle: at full, the rear wheels spin in first and Jolt holds the gear to the redline.
  const up = async (shiftUpRPM: number) => {
    const shift = shiftSpeed(1, 2);
    await drive({ shiftUpRPM, shiftDownRPM: 1000 }, { throttle: 0.5 }, 12, shift.watch);
    return shift.speed();
  };
  const [own, early] = [await up(CAR.shiftUpRPM), await up(3000)];
  assert.ok(early > 0 && early < 0.7 * own, `${early} m/s against ${own} m/s`);
});

test('shiftDownRPM: shifting down at a lower rpm leaves the gear at a lower speed', async () => {
  const down = async (shiftDownRPM: number) => {
    const rig = await drive({ shiftDownRPM }, { throttle: 1 }, 6);
    const gear = rig.vehicle.gear;
    const shift = shiftSpeed(gear, gear - 1);
    for (let s = 0; s < 1200 && shift.speed() < 0; s++) {
      rig.hold({ brake: 0.2 }, 1 / 60);
      shift.watch(rig);
    }
    return shift.speed();
  };
  const [own, late] = [await down(CAR.shiftDownRPM), await down(0.5 * CAR.shiftDownRPM)];
  assert.ok(late > 0 && late < 0.7 * own, `${late} m/s against ${own} m/s`);
});

test('maxRPM: half the redline caps one gear at half the speed', async () => {
  const top = async (maxRPM: number) =>
    (await drive({ gears: [1], finalDrive: 30, maxRPM }, { throttle: 1 }, 5)).vehicle.speed;
  const [own, half] = [await top(CAR.maxRPM), await top(CAR.maxRPM / 2)];
  const cap = redlineSpeed(30) / 2;
  assert.ok(half > 0.5 * cap && half < 1.05 * cap, `capped at ${half} of ${cap}`);
  assert.ok(own > 1.5 * cap, `the machine's own is not: ${own}`);
});

test('finalDrive: the redline caps one gear at the speed its ratio turns the wheels at', async () => {
  const top = async (finalDrive: number) =>
    (await drive({ gears: [1], finalDrive }, { throttle: 1 }, 5)).vehicle.speed;
  const [own, short] = [await top(CAR.finalDrive), await top(30)];
  assert.ok(short < 1.05 * redlineSpeed(30), `capped at ${short}`);
  assert.ok(own > 1.5 * redlineSpeed(30), `the machine's own is not: ${own}`);
});

test('reverse: the redline caps backing up at the speed the reverse ratio turns the wheels at', async () => {
  const back = async (reverse: number) =>
    -(await drive({ reverse }, { brake: 1 }, 5)).vehicle.speed;
  const [own, short] = [await back(CAR.reverse), await back(12)];
  const cap = redlineSpeed(12 * CAR.finalDrive);
  assert.ok(short > 0.5 * cap && short < 1.05 * cap, `capped at ${short} of ${cap}`);
  assert.ok(own > 2 * cap, `the machine's own is not: ${own}`);
});

test('clutch: a weaker clutch launches slower', async () => {
  const launch = async (clutch: number) =>
    (await drive({ clutch }, { throttle: 1 }, 1)).vehicle.speed;
  const [own, weak] = [await launch(CAR.clutch), await launch(0.5)];
  assert.ok(weak < 0.7 * own, `${weak} against ${own}`);
});
