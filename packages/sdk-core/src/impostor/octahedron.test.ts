import assert from 'node:assert/strict';
import test from 'node:test';
import { cellWeights, octDecode, octEncode } from './octahedron.ts';

test('full-sphere atlas landmarks map to the six world axes', () => {
  const landmarks = [
    { direction: [1, 0, 0], plane: [1, 0], grid: [1, 0.5] },
    { direction: [-1, 0, 0], plane: [-1, 0], grid: [0, 0.5] },
    { direction: [0, 1, 0], plane: [0, 0], grid: [0.5, 0.5] },
    { direction: [0, -1, 0], plane: [1, 1], grid: [1, 1] },
    { direction: [0, 0, 1], plane: [0, 1], grid: [0.5, 1] },
    { direction: [0, 0, -1], plane: [0, -1], grid: [0.5, 0] },
  ];
  for (const { direction, plane, grid } of landmarks) {
    assert.deepEqual(octEncode(direction, false), plane);
    const decoded = octDecode(grid, false);
    decoded.forEach((value, i) => assert.ok(Math.abs(value - direction[i]) < 1e-14));
  }
});

test('upper-hemisphere landmarks and the degenerate projection stay defined', () => {
  for (const [direction, plane, grid] of [
    [
      [1, 0, 0],
      [1, -1],
      [1, 0],
    ],
    [
      [-1, 0, 0],
      [-1, 1],
      [0, 1],
    ],
    [
      [0, 1, 0],
      [0, 0],
      [0.5, 0.5],
    ],
    [
      [0, 0, 1],
      [1, 1],
      [1, 1],
    ],
    [
      [0, 0, -1],
      [-1, -1],
      [0, 0],
    ],
  ]) {
    assert.deepEqual(octEncode(direction, true), plane);
    const decoded = octDecode(grid, true);
    decoded.forEach((value, i) => assert.ok(Math.abs(value - direction[i]) < 1e-14));
  }
  assert.deepEqual(octEncode([0, -1, 0], true), [0, 0]);
  assert.deepEqual(octEncode([0, 0, 0], true), [0, 0]);
  assert.deepEqual(octEncode([1, -4, 1], true), [1, 0]);
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
          [x, y, z].forEach((value, i) => assert.ok(Math.abs(decoded[i] - value / length) < 1e-14));
          assert.ok(Math.abs(Math.hypot(...decoded) - 1) < 1e-14);
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
        assert.ok(Math.abs(blend.reduce((sum, sample) => sum + sample.weight, 0) - 1) < 1e-14);
        for (const { frame, weight } of blend) {
          assert.ok(weight >= 0 && weight <= 1);
          assert.ok(frame.every((value) => Number.isInteger(value) && value >= 0 && value < n));
        }
        for (const [axis, expected] of [x, y].entries())
          assert.ok(
            Math.abs(
              blend.reduce((sum, sample) => sum + sample.frame[axis] * sample.weight, 0) - expected,
            ) < 1e-14,
          );
      }
});
