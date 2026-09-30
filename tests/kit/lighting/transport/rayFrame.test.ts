import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPatchRays } from './rays.ts';

test('rotating a physical facet rotates every sampled ray origin and direction with it', () => {
  const patch = { id: 3, center: [3, 5, 7], normal: [0, 0, 1], u: [2, 0, 0], v: [0, 4, 0] };
  const baseline = new Float64Array(64 * 6);
  fillPatchRays({ patches: [patch] } as any, 0, 64, baseline);
  const rotations = [
    ([x, y, z]: number[]) => [z, x, y],
    ([x, y, z]: number[]) => [x, -z, y],
    ([x, y, z]: number[]) => [-y, x, z],
  ];
  for (const rotate of rotations) {
    const rotated = {
      ...patch,
      center: rotate(patch.center),
      normal: rotate(patch.normal),
      u: rotate(patch.u),
      v: rotate(patch.v),
    };
    const rays = new Float64Array(64 * 6);
    fillPatchRays({ patches: [rotated] } as any, 0, 64, rays);
    for (let offset = 0; offset < rays.length; offset += 3) {
      const expected = rotate([...baseline.slice(offset, offset + 3)]);
      for (let axis = 0; axis < 3; axis++)
        assert.ok(Math.abs(rays[offset + axis] - expected[axis]) < 1e-12);
    }
  }
});
