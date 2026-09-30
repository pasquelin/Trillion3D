import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPatchRays } from './rays.ts';

test('the next patch uses the golden-angle azimuth and all four quadrants of a vertical tangent', () => {
  const patch = { id: 1, center: [3, 5, 7], normal: [0, 1, 0], u: [0, 0, 2], v: [2, 0, 0] };
  const rays = new Float64Array(48);
  fillPatchRays({ patches: [{ ...patch, id: 0 }, patch] } as any, 1, 4, rays);
  // The second golden-angle sample has azimuth 222.49223594996215 degrees and elevation 45 degrees.
  const direction = [-0.47764376769801975, 0.7071067811865475, -0.5213985339250965];
  const origins = [
    [2.5, 5.0000004, 6.5],
    [2.5, 5.0000004, 7.5],
    [3.5, 5.0000004, 6.5],
    [3.5, 5.0000004, 7.5],
  ];
  for (let sample = 0; sample < 4; sample++)
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(rays[24 + sample * 6 + axis] - origins[sample][axis]) < 1e-12);
      assert.ok(Math.abs(rays[27 + sample * 6 + axis] - direction[axis]) < 1e-12);
    }
});
