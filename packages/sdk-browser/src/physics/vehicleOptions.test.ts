import test from 'node:test';
import assert from 'node:assert/strict';
import type { VehicleInput, VehicleOptions } from '../../../sdk-core/src/physics/index.ts';
import { VEHICLE_SPECS } from '../../../sdk-core/src/physics/vehicleSpec.ts';
import { vehicleRig } from './vehicles.fixture.ts';

// Every option a vehicle offers, set against its machine's own value on the committed module: each
// test fails if `vehicles.cpp` ignores the option or reads it at another word.

const CAR = VEHICLE_SPECS.car;
/** The car's wheel radius and wheelbase in the rig (`vehicles.fixture.ts`), m. */
const RADIUS = 0.33,
  WHEELBASE = 2.66;
/** The speed at which the engine's redline turns the wheels through `ratio`, m/s. */
const redlineSpeed = (ratio: number) => (CAR.maxRPM / 60) * 2 * Math.PI * (RADIUS / ratio);
type Rig = Awaited<ReturnType<typeof vehicleRig>>;
/** The body's pitch, radians: its nose's rise. */
function pitch(rig: Rig) {
  const [x, y, z, w] = rig.turn(rig.body);
  return Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z))));
}
/** A wheel's turn about y from straight ahead, radians: its axle, (0, 1, 0) on the cylinder. */
function steerOf(rig: Rig, wheel: number) {
  const [x, y, z, w] = rig.wheels[wheel].quaternion.toArray();
  return Math.abs(Math.atan2(2 * (y * z + w * x), -2 * (x * y - w * z)));
}
/** The angle between two quaternions, radians. */
function between(p: number[], q: number[]) {
  const dot = Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]);
  return 2 * Math.acos(Math.min(1, dot));
}
/** A car of `options` from standstill: `watch` read after every step of `seconds` of `input`. */
async function drive(
  options: Partial<VehicleOptions>,
  input: Partial<VehicleInput>,
  seconds: number,
  watch: (rig: Rig) => void = () => {},
) {
  const rig = await vehicleRig('car', options);
  for (let s = 0; s < seconds * 60; s++) {
    rig.hold(input, 1 / 60);
    watch(rig);
  }
  return rig;
}

test('torquePerKg: half the torque reaches 10 m/s later', async () => {
  const until10 = async (torquePerKg: number) => {
    let steps = 0;
    await drive({ torquePerKg }, { throttle: 1 }, 5, (rig) => (steps += +(rig.vehicle.speed < 10)));
    return steps;
  };
  const [full, half] = [await until10(CAR.torquePerKg), await until10(CAR.torquePerKg / 2)];
  assert.ok(half > 1.2 * full, `${half} steps against ${full}`);
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

/** The car's greatest pitch and front wheel rise against its body in a second of full braking
 *  from three seconds of full throttle. */
async function dive(options: Partial<VehicleOptions>) {
  const rig = await drive(options, { throttle: 1 }, 3);
  let most = 0,
    rise = 0;
  for (let s = 0; s < 60; s++) {
    rig.hold({ brake: 1 }, 1 / 60);
    most = Math.max(most, Math.abs(pitch(rig)));
    rise = Math.max(rise, rig.wheels[0].position.y - rig.placed[0][1]);
  }
  return { most, rise };
}

test('suspensionFrequency: springs twice as stiff in frequency dive a quarter as far', async () => {
  const [own, stiff] = [
    await dive({}),
    await dive({ suspensionFrequency: 2 * CAR.suspensionFrequency }),
  ];
  // A spring's stiffness goes as its frequency squared.
  const ratio = stiff.most / own.most;
  assert.ok(ratio > 0.15 && ratio < 0.4, `${stiff.most} of ${own.most}`);
});

test('suspensionTravel: a shorter travel stops the wheel sooner against the body', async () => {
  const [own, short] = [await dive({}), await dive({ suspensionTravel: 0.12 })];
  assert.ok(short.rise < 0.6 * own.rise, `${short.rise} against ${own.rise}`);
});

test('suspensionDamping: underdamped, the body rocks longer once the throttle lets go', async () => {
  const rocking = async (suspensionDamping: number) => {
    const rig = await drive({ suspensionDamping }, { throttle: 1 }, 1);
    const pitches: number[] = [];
    rig.hold({}, 0.3);
    for (let s = 0; s < 120; s++) {
      rig.hold({}, 1 / 60);
      pitches.push(pitch(rig));
    }
    return Math.max(...pitches) - Math.min(...pitches);
  };
  const [own, loose] = [await rocking(CAR.suspensionDamping), await rocking(0.05)];
  assert.ok(loose > 2 * own, `${loose} against ${own}`);
});

test('steerTime: a slower hand takes the wheel to lock later', async () => {
  const lock = Math.asin(WHEELBASE / CAR.turnRadius);
  const after = async (steerTime: number) =>
    steerOf(await drive({ steerTime }, { steer: 1 }, 0.1), 0);
  const [own, slow] = [await after(CAR.steerTime), await after(1)];
  assert.ok(Math.abs(own - (0.1 / CAR.steerTime) * lock) < 0.02, `own ${own}`);
  assert.ok(Math.abs(slow - 0.1 * lock) < 0.02, `slow ${slow}`);
});

test('brakeGrip: brakes that lock the wheels at a third of the grip stop far longer', async () => {
  const stopping = async (brakeGrip: number) => {
    const rig = await drive({ brakeGrip }, { throttle: 1 }, 4);
    const from = rig.at(rig.body)[2];
    for (let s = 0; s < 1800 && rig.vehicle.speed > 0.2; s++) rig.hold({ brake: 1 }, 1 / 60);
    return from - rig.at(rig.body)[2];
  };
  const [own, weak] = [await stopping(CAR.brakeGrip), await stopping(0.3)];
  assert.ok(weak > 2 * own, `${weak} m against ${own} m`);
});

test('drive: front, only the front wheels spin under throttle on a lift', async () => {
  const spun = async (driven: VehicleOptions['drive']) => {
    const rig = await vehicleRig('car', { drive: driven });
    // No weight on the wheels: the springs lift the body clear and the wheels hang free.
    rig.writer.gravity([0, 0, 0]);
    rig.run(60);
    const turned = [0, 0, 0, 0];
    for (let s = 0; s < 30; s++) {
      const before = rig.wheels.map((wheel) => wheel.quaternion.toArray());
      rig.hold({ throttle: 1 }, 1 / 60);
      rig.wheels.forEach(
        (wheel, i) => (turned[i] += between(before[i], wheel.quaternion.toArray())),
      );
    }
    return turned;
  };
  const [front, rear] = [await spun('front'), await spun('rear')];
  assert.ok(Math.min(front[0], front[1]) > 20 * Math.max(front[2], front[3]), `front ${front}`);
  assert.ok(Math.min(rear[2], rear[3]) > 20 * Math.max(rear[0], rear[1]), `rear ${rear}`);
});

test('trackTurn: the inner track at the outer’s speed does not turn a moving hull', async () => {
  const turned = async (trackTurn: number) => {
    const rig = await vehicleRig('tracked', { trackTurn });
    rig.hold({ throttle: 1 }, 3);
    const yaw = rig.yaw(rig.body);
    rig.hold({ throttle: 1, steer: 1 }, 2);
    return Math.abs(rig.yaw(rig.body) - yaw);
  };
  const [straight, own, sharp] = [await turned(1), await turned(0.6), await turned(0.2)];
  assert.ok(straight < 0.05, `straight ${straight}`);
  assert.ok(sharp > 1.1 * own && own > 0.5, `sharper ${sharp} than ${own}`);
});

test('maxLean: a motorcycle leans no further than its greatest lean', async () => {
  const leaned = async (maxLean: number) => {
    const rig = await vehicleRig('motorcycle', { maxLean });
    rig.hold({ throttle: 1 }, 2);
    let most = 0;
    for (let s = 0; s < 180; s++) {
      rig.hold({ throttle: 0.15, steer: 0.4 }, 1 / 60);
      most = Math.max(most, rig.tilt());
    }
    return most;
  };
  const [own, capped] = [await leaned(VEHICLE_SPECS.motorcycle.maxLean), await leaned(0.1)];
  assert.ok(capped < 0.12, `capped at ${capped}`);
  assert.ok(own > 0.3, `the machine's own leans ${own}`);
});
