import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPatchRays } from './rays.ts';

// Independent reference: 80-digit mpmath evaluation of the golden-ratio hemisphere
// sequence, with exact (sqrt(5)-1)/2, pi and square roots, rounded once to binary64.
// Coordinates are for a +Y normal and +X tangent; the bitangent points along -Z.
const cases = [
  {
    patch: 13254,
    direction: 11,
    expected: [0.07985372305334498, -0.8440221459858264],
    error: 5e-12,
  },
  {
    patch: 1,
    direction: 15,
    expected: [-0.9249389950445335, 0.3365083289400257],
    error: 2 * Number.EPSILON,
  },
  { patch: 3, direction: 4, expected: [0.5257648546014594, 0.06943570886731315], error: 1e-15 },
];

for (const { patch, direction, expected, error } of cases)
  test(`golden-angle ray precision at patch ${patch}, direction ${direction}`, () => {
    const patches = Array.from({ length: patch + 1 }, (_, id) => ({
      id,
      center: [0, 0, 0],
      normal: [0, 1, 0],
      u: [1, 0, 0],
      v: [0, 0, 1],
    }));
    const rays = new Float64Array((patch + 1) * 64 * 6);
    fillPatchRays({ patches } as any, patch, 64, rays);
    const offset = (patch * 64 + direction * 4) * 6;
    assert.ok(Math.abs(rays[offset + 3] - expected[0]) <= error);
    assert.ok(Math.abs(rays[offset + 5] - expected[1]) <= error);
  });
