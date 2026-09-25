import test from 'node:test';
import assert from 'node:assert/strict';
import type { PhysicsShape } from '../../../sdk-core/src/physics/index.ts';
import { cylinder } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { Ray } from '../../../sdk-core/src/world/math/volumes.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { jointRig } from './joints.fixture.ts';

const TAPERED = { type: 'cylinder', halfHeight: 1, radius: 0.2, radiusBottom: 0.5 } as const;

for (const [name, shape] of [
  ['a body', TAPERED],
  ['a compound part', { type: 'compound', parts: [{ ...TAPERED, position: [0, 0, 0] }] }],
] as const)
  test(`a cylinder given a bottom radius tapers as it is drawn: ${name}`, async () => {
    const rig = await jointRig([0, 0, 0]);
    const drawn = new Mesh(cylinder(0.2, 0.5, 2), new Material('meshStandard'));
    drawn.physics = { type: 'static', shape: shape as PhysicsShape };
    rig.scene.add(drawn);
    rig.run(1);
    // Its radius runs straight from 0.5 at its bottom to 0.2 at its top.
    for (const y of [-0.9, 0, 0.9]) {
      const ray = new Ray(new Vector3(-5, y, 0), new Vector3(1, 0, 0));
      const hit = await rig.raycast(ray, { exact: true, maxDistance: 10 });
      const radius = 0.5 - (0.3 * (y + 1)) / 2;
      assert.equal(hit?.object, drawn);
      assert.ok(Math.abs(hit!.point.x + radius) < 2e-3, `at ${y}: ${hit!.point.x} for ${-radius}`);
    }
  });
