import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicle } from '../../../sdk-core/src/physics/vehicle.ts';
import { box, cylinder } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { flatRig } from './vehicles.fixture.ts';

const RADIUS = 0.33,
  WHEEL_Y = -0.5;

/**
 * A 1200 kg car, 1.8 × 1.2 × 4.4 m, its axles at `z` from its body's origin, placed resting on
 * flat ground and left five seconds: how far each wheel rests from where it was placed on the body.
 */
async function restingGaps(axles: [number, number]) {
  const rig = await flatRig();
  const body = new Mesh(box(1.8, 1.2, 4.4), new Material('meshStandard'));
  body.physics = { mass: 1200 };
  body.position.set(0, RADIUS - WHEEL_Y, 0);
  const placed = axles.flatMap((z) => [-0.8, 0.8].map((x) => [x, WHEEL_Y, z]));
  const wheels = placed.map(([x, y, z]) => {
    const wheel = new Mesh(cylinder(RADIUS, RADIUS, 0.25), new Material('meshStandard'));
    wheel.position.set(x, y, z);
    wheel.rotation.z = Math.PI / 2;
    body.add(wheel);
    return wheel;
  });
  rig.scene.add(body);
  rig.driven.add(vehicle.car(body, { wheels }));
  rig.run(300);
  return wheels.map((wheel, i) => wheel.position.y - placed[i][1]);
}

test('a car whose body origin is off its wheelbase’s middle still rests on its wheels as placed', async () => {
  // Off by 0.2 m, then with the origin on the front axle: the module's own frequency spring takes its
  // arm from the body origin, the sag from the centre of mass, and they part by millimetres.
  for (const axles of [
    [-1.2, 1.6],
    [0, 2.8],
  ] as [number, number][]) {
    const gaps = await restingGaps(axles);
    assert.ok(
      gaps.every((gap) => Math.abs(gap) < 0.001),
      `axles at ${axles}: wheels off by ${gaps.map((gap) => (gap * 1000).toFixed(1))} mm`,
    );
  }
});
