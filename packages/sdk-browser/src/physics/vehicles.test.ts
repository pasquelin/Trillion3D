import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleRig } from './vehicles.fixture.ts';

/** Per kind, the gear and the speed (m/s) ten seconds of full throttle reach at least: the car
 *  and the motorcycle into third, the 61 t hull into its fourth and last. */
const REACH = { car: [3, 25], motorcycle: [3, 25], tracked: [4, 12] } as const;

for (const kind of ['car', 'motorcycle', 'tracked'] as const) {
  test(`${kind}: the suspension holds the body on its wheels, level and still`, async () => {
    const rig = await vehicleRig(kind);
    const rest = rig.at(rig.body)[1];
    rig.run(300);
    assert.ok(Math.abs(rig.at(rig.body)[1] - rest) < 0.01, `it stays: ${rig.at(rig.body)[1]}`);
    assert.ok(rig.tilt() < 0.02, `level: ${rig.tilt()}`);
    assert.equal(rig.vehicle.speed.toFixed(2), '0.00');
    // Its wheels were placed as they rest: the springs sag it back exactly there.
    assert.ok(Math.abs(rest - rig.body.position.y) < 0.005, `as placed: ${rest}`);
    const posed = rig.wheels.map((wheel, i) => wheel.position.y - rig.placed[i][1]);
    assert.ok(
      posed.every((gap) => Math.abs(gap) < 0.005),
      `wheels as placed: ${posed}`,
    );
  });

  test(`${kind}: the throttle accelerates it through the gears`, async () => {
    const rig = await vehicleRig(kind);
    const speeds: number[] = [];
    for (let s = 0; s < 10; s++) {
      rig.hold({ throttle: 1 }, 1);
      speeds.push(rig.vehicle.speed);
    }
    const [gear, speed] = REACH[kind];
    assert.ok(rig.vehicle.gear >= gear, `gear ${rig.vehicle.gear}`);
    assert.ok(rig.vehicle.speed > speed, `speed ${rig.vehicle.speed}`);
    assert.ok(
      speeds.every((v, i) => i < 2 || v > speeds[i - 2]),
      `ever faster: ${speeds}`,
    );
    assert.ok(rig.at(rig.body)[2] < -50, 'forward is −z');
    assert.notEqual(rig.wheels[0].quaternion.w, 1, 'its wheels turn');
  });

  test(`${kind}: the brake stops it, then backs it up`, async () => {
    const rig = await vehicleRig(kind);
    rig.hold({ throttle: 1 }, 6);
    const from = rig.vehicle.speed;
    let seconds = 0;
    while (rig.vehicle.speed > 0.5 && seconds < 20) {
      rig.hold({ brake: 1 }, 0.25);
      seconds += 0.25;
    }
    assert.ok(from / seconds > 5, `over half a g: ${from} m/s in ${seconds} s`);
    rig.hold({ brake: 1 }, 2);
    assert.ok(rig.vehicle.speed < -0.5 && rig.vehicle.gear === -1, `reverse ${rig.vehicle.speed}`);
    rig.hold({ throttle: 1 }, 2);
    assert.ok(rig.vehicle.speed > -0.5, 'the throttle brakes the backing first');
  });

  for (const steer of [1, -1])
    test(`${kind}: steering ${steer > 0 ? 'right' : 'left'} turns it that way`, async () => {
      const rig = await vehicleRig(kind);
      rig.hold({ throttle: 1 }, 2);
      const yaw = rig.yaw(rig.body);
      rig.hold({ throttle: 1, steer }, 2);
      // Facing −z, a turn to the right is a clockwise one seen from above: a yaw that falls.
      const turned = rig.yaw(rig.body) - yaw;
      assert.ok(-steer * turned > 0.3, `turned ${turned}`);
    });
}

test('tracked: steered at a standstill, it turns on the spot', async () => {
  const rig = await vehicleRig('tracked');
  rig.hold({ steer: 1 }, 2);
  assert.ok(rig.yaw(rig.body) < -0.5, `pivoted ${rig.yaw(rig.body)}`);
  assert.ok(Math.hypot(rig.at(rig.body)[0], rig.at(rig.body)[2]) < 0.5, 'in place');
});

test('the handbrake holds the car on its rear wheels', async () => {
  const rig = await vehicleRig('car');
  rig.hold({ throttle: 1, handbrake: true }, 2);
  const held = rig.vehicle.speed;
  const free = await vehicleRig('car');
  free.hold({ throttle: 1 }, 2);
  assert.ok(held < free.vehicle.speed / 2, `held ${held}, free ${free.vehicle.speed}`);
});

test('a vehicle taken out gives its wheels back their pose, its body left without wheels', async () => {
  const rig = await vehicleRig('car');
  const placed = rig.placed[0];
  rig.hold({ throttle: 1 }, 1);
  assert.notDeepEqual(rig.wheels[0].position.toArray(), placed, 'posed by the simulation');
  rig.driven.delete(rig.vehicle);
  rig.run(60);
  assert.deepEqual(rig.wheels[0].position.toArray(), placed);
  assert.equal(rig.wheels[0].quaternion.z.toFixed(6), Math.sin(Math.PI / 4).toFixed(6));
  assert.equal(rig.vehicle.speed, 0);
  assert.ok(rig.at(rig.body)[1] < 0.3, 'the body fell onto the ground');
});
