// The octahedral atlas mapping, the port of the compiler's `impostor/octahedron.rs`: each world axis
// lands on its corner or edge of the plane and back, every direction round trips through both
// folds, and a view blends the three frames of its triangle with weights that rebuild its position.
import assert from 'node:assert/strict';
import test from 'node:test';
import { near } from '../math/near.fixture.ts';
import { cellWeights, octDecode, octEncode } from './octahedron.ts';

test('the world axes land on their places of the plane and decode back from the grid', () => {
  const landmarks = [
    { hemi: false, direction: [1, 0, 0], plane: [1, 0], grid: [1, 0.5] },
    { hemi: false, direction: [-1, 0, 0], plane: [-1, 0], grid: [0, 0.5] },
    { hemi: false, direction: [0, 1, 0], plane: [0, 0], grid: [0.5, 0.5] },
    // Straight down sits on the +,+ corner: the fold gives an axis the side `+1`, never 0.
    { hemi: false, direction: [0, -1, 0], plane: [1, 1], grid: [1, 1] },
    { hemi: false, direction: [0, 0, 1], plane: [0, 1], grid: [0.5, 1] },
    { hemi: false, direction: [0, 0, -1], plane: [0, -1], grid: [0.5, 0] },
    { hemi: true, direction: [1, 0, 0], plane: [1, -1], grid: [1, 0] },
    { hemi: true, direction: [-1, 0, 0], plane: [-1, 1], grid: [0, 1] },
    { hemi: true, direction: [0, 1, 0], plane: [0, 0], grid: [0.5, 0.5] },
    { hemi: true, direction: [0, 0, 1], plane: [1, 1], grid: [1, 1] },
    { hemi: true, direction: [0, 0, -1], plane: [-1, -1], grid: [0, 0] },
  ];
  for (const { hemi, direction, plane, grid } of landmarks) {
    assert.deepEqual(octEncode(direction, hemi), plane, `encode ${direction} hemi ${hemi}`);
    near(octDecode(grid, hemi), direction, `decode ${grid} hemi ${hemi}`, 1e-14);
  }
});

test('the upper hemi-octahedron folds a direction below the horizon onto it', () => {
  for (const [x, z] of [
    [1, 1],
    [-2, 0.5],
    [0, -3],
  ])
    assert.deepEqual(octEncode([x, -4, z], true), octEncode([x, 0, z], true));
  // Straight down and no direction at all have no horizontal part: both read the zenith frame.
  assert.deepEqual(octEncode([0, -1, 0], true), [0, 0]);
  assert.deepEqual(octEncode([0, 0, 0], true), [0, 0]);
});

test('atlas encode/decode round trips preserve directions across both folds and quadrants', () => {
  for (const hemi of [false, true])
    for (const x of [-3, -1, 0, 2, 5])
      for (const y of hemi ? [0, 1, 4] : [-4, -1, 0, 1, 4])
        for (const z of [-5, -2, 0, 1, 3]) {
          const length = Math.hypot(x, y, z);
          if (!length) continue;
          const encoded = octEncode([x, y, z], hemi);
          assert.ok(encoded.every((value) => value >= -1 && value <= 1));
          const decoded = octDecode(
            encoded.map((value) => (value + 1) / 2),
            hemi,
          );
          near(decoded, [x / length, y / length, z / length], `${[x, y, z]} hemi ${hemi}`, 1e-14);
        }
});

test('cell blends choose the enclosing triangle and preserve the requested grid position', () => {
  assert.deepEqual(cellWeights([1.75, 2.25], 5), [
    { frame: [1, 2], weight: 0.25 },
    { frame: [2, 2], weight: 0.5 },
    { frame: [2, 3], weight: 0.25 },
  ]);
  assert.deepEqual(cellWeights([1.25, 2.75], 5), [
    { frame: [1, 2], weight: 0.25 },
    { frame: [1, 3], weight: 0.5 },
    { frame: [2, 3], weight: 0.25 },
  ]);
  assert.deepEqual(cellWeights([1.5, 2.5], 5), [
    { frame: [1, 2], weight: 0.5 },
    { frame: [1, 3], weight: 0 },
    { frame: [2, 3], weight: 0.5 },
  ]);
  for (const n of [2, 3, 5])
    for (const x of [0, 0.2, 1, n - 1])
      for (const y of [0, 0.7, 1, n - 1]) {
        const blend = cellWeights([x, y], n);
        assert.equal(blend.length, 3);
        for (const { frame, weight } of blend) {
          assert.ok(weight >= 0 && weight <= 1);
          assert.ok(frame.every((value) => Number.isInteger(value) && value >= 0 && value < n));
        }
        const sum = (of: (frame: number[]) => number) =>
          blend.reduce((total, sample) => total + of(sample.frame) * sample.weight, 0);
        near(
          [sum(() => 1), sum(([i]) => i), sum(([, j]) => j)],
          [1, x, y],
          `${[x, y]} of ${n}`,
          1e-14,
        );
      }
});
