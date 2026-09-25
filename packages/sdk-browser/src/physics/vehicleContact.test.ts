import test from 'node:test';
import assert from 'node:assert/strict';
import { box, sphere } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { Ray } from '../../../sdk-core/src/world/math/volumes.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { jointRig, type Rig } from './joints.fixture.ts';
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

/** What a ray from `from` along `along` meets first, passing through `ignore`: its object and
 *  point, or `null`. */
const meets = (rig: Rig, from: number[], along: number[], ignore?: Mesh) =>
  rig.raycast(new Ray(new Vector3(...from), new Vector3(...along)), {
    exact: true,
    maxDistance: 100,
    ignore,
  });

test('the running gear of a vehicle is solid, clear of flat ground, and goes when it stops being one', async () => {
  const rig = await flatRig();
  // Dropped half a metre: its suspension takes the landing at full bump.
  const tank = placeVehicle(rig, 'tracked', {}, [0, 0.5, 0]);
  const { size, wheels, width } = tank.machine;
  const across = [1, 0, 0];
  for (let s = 0; s < 120; s++) {
    rig.run(1);
    const low = await meets(rig, [-10, 0.01, 0], across);
    assert.equal(low?.object, undefined, `clear of the ground at step ${s}: ${low?.point.x}`);
  }
  // Under its hull, over its wheels' footprint: solid out to its tracks' outer edges.
  const under = () => rig.at(tank.body)[1] - size[1] / 2 - 0.05;
  const gear = await meets(rig, [-10, under(), 0], across);
  assert.equal(gear?.object, tank.body);
  const edge = Math.max(...wheels.map(([x]) => Math.abs(x))) + width / 2;
  assert.ok(Math.abs(gear!.point.x + edge) < 0.01, `to its tracks' edge: ${gear!.point.x}`);
  rig.driven.delete(tank.vehicle);
  rig.run(1);
  assert.equal(await meets(rig, [-10, under(), 0], across), null, 'gone with the vehicle');
});

test('the running gear weighs nothing: a hit turns a vehicle as it turns one without gear', async () => {
  /** A car in free fall struck on its side, ahead of its centre, above its gear by a 50 kg ball
   *  at 10 m/s: its turn a second later. A travel of 0.4 m raises its wheels' lowest point above
   *  its body's bottom, so it has no gear; at 0.2 m it has 0.18 m of it. */
  const struck = async (suspensionTravel: number) => {
    const rig = await jointRig([0, 0, 0]);
    const car = placeVehicle(rig, 'car', { suspensionTravel });
    const ball = new Mesh(sphere(0.1), new Material('meshStandard'));
    ball.position.set(3, rig.at(car.body)[1] + 0.15, -0.6);
    ball.physics = { mass: 50 };
    rig.scene.add(ball);
    rig.run(1);
    rig.writer.velocity(ball.physics._index, [-10, 0, 0]);
    rig.run(60);
    return rig.turn(car.body);
  };
  const [plain, geared] = [await struck(0.4), await struck(0.2)];
  assert.ok(Math.abs(plain[1]) > 0.02, `the hit turns it: ${plain}`);
  for (let i = 0; i < 4; i++)
    assert.ok(Math.abs(plain[i] - geared[i]) < 1e-3, `the same turn: ${plain} ${geared}`);
});

test('a ray told to ignore a vehicle passes through it to the ground', async () => {
  const rig = await flatRig();
  const tank = placeVehicle(rig, 'tracked');
  rig.run(60);
  const down = [0, -1, 0];
  const top = await meets(rig, [0, 60, 0], down);
  assert.equal(top?.object, tank.body);
  const ground = await meets(rig, [0, 60, 0], down, tank.body);
  assert.ok(ground && ground.object !== tank.body, 'the ground');
  assert.ok(Math.abs(ground.point.y) < 1e-3, `at its top: ${ground.point.y}`);
});
