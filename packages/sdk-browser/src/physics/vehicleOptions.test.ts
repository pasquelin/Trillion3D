import test from 'node:test';
import assert from 'node:assert/strict';
import type { VehicleOptions } from '../../../sdk-core/src/physics/index.ts';
import { VEHICLE_SPECS } from '../../../sdk-core/src/physics/vehicleSpec.ts';
import { driveCar as drive, type VehicleRig as Rig, vehicleRig } from './vehicles.fixture.ts';

// The chassis options of every vehicle — suspension, steering, brakes, driven wheels, tracks and
// lean — set against its machine's own value on the committed module: each test fails if
// `vehicles.cpp` ignores the option or reads it at another word. The engine and gearbox's are in
// `vehiclePowertrain.test.ts`.

const CAR = VEHICLE_SPECS.car;
/** The car's wheelbase in the rig (`vehicles.fixture.ts`), m. */
const WHEELBASE = 2.66;
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

test('trackTurn, on the move: the inner track at the outer’s speed keeps the hull straight, a lower ratio turns it harder', async () => {
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
