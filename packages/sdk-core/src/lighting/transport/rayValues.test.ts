import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPatchRays } from './rays.ts';

test('patch rays start at all four facet quadrants and sample known directions on the unit hemisphere', () => {
  const scene = {
    patches: [{ id: 0, center: [3, 5, 7], normal: [0, 0, 1], u: [2, 0, 0], v: [0, 4, 0] }],
  } as any;
  const rays = new Float64Array(16 * 6 + 3).fill(99);
  fillPatchRays(scene, 0, 16, rays);
  const directions = [
    [Math.sqrt(0.125), 0, Math.sqrt(0.875)],
    [-Math.sqrt(0.375), 0, Math.sqrt(0.625)],
    [0, Math.sqrt(0.625), Math.sqrt(0.375)],
    [0, -Math.sqrt(0.875), Math.sqrt(0.125)],
  ];
  const origins = [
    [2.5, 4, 7.0000004],
    [3.5, 4, 7.0000004],
    [2.5, 6, 7.0000004],
    [3.5, 6, 7.0000004],
  ];
  for (let i = 0; i < 16; i++) {
    const origin = [...rays.slice(i * 6, i * 6 + 3)],
      direction = [...rays.slice(i * 6 + 3, i * 6 + 6)];
    origin.forEach((value, k) => assert.ok(Math.abs(value - origins[i % 4][k]) < 1e-12));
    direction.forEach((value, k) =>
      assert.ok(Math.abs(value - directions[Math.floor(i / 4)][k]) < 1e-12),
    );
    assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-12);
  }
  assert.deepEqual([...rays.slice(96)], [99, 99, 99]);
  scene.patches[0].u = [0, 0, 0];
  assert.throws(
    () => fillPatchRays(scene, 0, 16, rays),
    (error: any) => error.code === 'INVALID_SCENE' && error.message.includes('tangent'),
  );
});

test('distinct patches fill only their own ray ranges and retain hemisphere orientation on every axis', () => {
  const patches = [
    { id: 0, center: [1, 2, 3], normal: [1, 0, 0], u: [0, 3, 0], v: [0, 0, 2] },
    { id: 1, center: [4, 5, 6], normal: [0, 1, 0], u: [0, 0, 3], v: [2, 0, 0] },
  ];
  const rays = new Float64Array(2 * 64 * 6).fill(99);
  fillPatchRays({ patches } as any, 1, 64, rays);
  assert.ok(rays.slice(0, 384).every((value) => value === 99));
  fillPatchRays({ patches } as any, 0, 64, rays);
  for (let patch = 0; patch < 2; patch++)
    for (let i = 0; i < 64; i++) {
      const offset = (patch * 64 + i) * 6;
      const direction = [...rays.slice(offset + 3, offset + 6)];
      assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-12);
      assert.ok(direction[patch] > 0);
      assert.ok(Math.abs(rays[offset + patch] - patches[patch].center[patch] - 0.0000004) < 1e-12);
    }
});
