import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import type { Rig } from './joints.fixture.ts';
import { flatRig, placeVehicle } from './vehicles.fixture.ts';

/** Jolt's penetration slop (`PhysicsSettings::mPenetrationSlop`, m): the overlap its contacts
 *  leave by design, and all two bodies at rest against each other may share. */
const SLOP = 0.02;
const FULL = { throttle: 1, brake: 0, steer: 0, handbrake: false };
type Box = [[number, number, number], [number, number, number]];

/** How deep `point`, in `a`'s frame, lies inside the box `[min, max]` in `b`'s frame; 0 outside. */
function depth(rig: Rig, a: Mesh, point: readonly number[], b: Mesh, [min, max]: Box) {
  const p = new Vector3(...point)
    .applyQuaternion(new Quaternion(...rig.turn(a)))
    .add(new Vector3(...rig.at(a)))
    .sub(new Vector3(...rig.at(b)))
    .applyQuaternion(new Quaternion(...rig.turn(b)).invert());
  const inside = [
    p.x - min[0],
    max[0] - p.x,
    p.y - min[1],
    max[1] - p.y,
    p.z - min[2],
    max[2] - p.z,
  ];
  return Math.max(0, Math.min(...inside));
}

/**
 * What a tank of `placeVehicle` fills as it is drawn: its hull, and under it, over its wheels'
 * footprint down to their lowest point, its running gear. Jolt only casts the wheels.
 */
function drawn({ size, wheels, radius, width }: ReturnType<typeof placeVehicle>['machine']) {
  const [hx, hy, hz] = size.map((side) => side / 2);
  const x = Math.max(...wheels.map(([x]) => Math.abs(x))) + width / 2;
  const z = Math.max(...wheels.map(([, , z]) => Math.abs(z))) + radius;
  const hull: Box = [
    [-hx, -hy, -hz],
    [hx, hy, hz],
  ];
  const gear: Box = [
    [-x, wheels[0][1] - radius, -z],
    [x, -hy, z],
  ];
  return { hull, gear };
}

/** A car and a tank on flat ground, both facing −z, the car's centre `gap` metres behind the
 *  tank's rear (+z), on a slope of `slope` radians that meets the ground there. */
async function carBehindTank(gap: number, slope = 0) {
  const rig = await flatRig();
  const tank = placeVehicle(rig, 'tracked');
  const rear = tank.machine.size[2] / 2;
  if (slope > 0) {
    const ramp = new Mesh(box(20, 1, 60), new Material('meshStandard', { physics: 'stone' }));
    const [s, c] = [Math.sin(slope), Math.cos(slope)];
    ramp.rotation.x = -slope;
    ramp.position.set(0, 30 * s - 0.5 * c, rear + 30 * c + 0.5 * s);
    ramp.physics = 'static';
    rig.scene.add(ramp);
  }
  const car = placeVehicle(rig, 'car', {}, [0, gap * Math.tan(slope), rear + gap]);
  car.body.rotation.x = -slope;
  rig.run(60);
  // The car's corners, inside its rounded edges; the first four are its front face's.
  const [w, h, d] = car.machine.size.map((side) => side / 2 - 0.1);
  const corners = [-d - 0.1, d + 0.1].flatMap((z) =>
    [-w, w].flatMap((x) => [-h, h].map((y) => [x, y, z])),
  );
  const regions = drawn(tank.machine);
  /** How deep the car's corners (`front`: its front face's) lie in the tank's `region`. */
  const inside = (region: keyof typeof regions, front = false) =>
    Math.max(
      ...corners
        .slice(0, front ? 4 : 8)
        .map((corner) => depth(rig, car.body, corner, tank.body, regions[region])),
    );
  /** The deepest its front goes into `region` as the car drives on for `seconds`, and its
   *  top speed. */
  const drive = (seconds: number, region: keyof typeof regions) => {
    let deepest = 0,
      fastest = 0;
    for (let s = 0; s < seconds * 60; s++) {
      car.vehicle.drive(FULL);
      rig.run(1);
      fastest = Math.max(fastest, car.vehicle.speed);
      deepest = Math.max(deepest, inside(region, true));
    }
    return { deepest, fastest };
  };
  return { rig, car, inside, drive };
}

test('a car driven into a tank at full speed stops against it, not inside it', async () => {
  const { car, drive } = await carBehindTank(60);
  // Contact within a step of its closing speed, then they share no more than Jolt's slop.
  const hit = drive(6, 'hull');
  assert.ok(hit.fastest > 15, `it hits hard: ${hit.fastest} m/s`);
  assert.ok(hit.deepest < hit.fastest / 60, `within a step: ${hit.deepest}`);
  const after = drive(1, 'hull');
  assert.ok(after.deepest <= SLOP, `apart but for the slop: ${after.deepest}`);
  assert.ok(Math.abs(car.vehicle.speed) < 2, `stopped by it: ${car.vehicle.speed}`);
});

test('a car driven down a slope into a tank does not slip under it among its wheels', async () => {
  const { drive } = await carBehindTank(1, (10 * Math.PI) / 180);
  const { deepest } = drive(6, 'gear');
  assert.ok(deepest <= SLOP, `kept out of its running gear: ${deepest}`);
});

test('a car made where a tank stands is pushed out of it, not under it', async () => {
  const { rig, inside } = await carBehindTank(-2);
  rig.run(120);
  assert.ok(inside('hull') <= SLOP, `out of its hull: ${inside('hull')}`);
  assert.ok(inside('gear') <= SLOP, `out of its running gear: ${inside('gear')}`);
});
