import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../world/geometry/geometry.ts';
import { BufferAttribute } from '../world/buffer/attribute.ts';
import { primitive, resolveShape } from './shape.ts';
import { SHAPE } from './layout.ts';

function triangle(indexed = false) {
  const value = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 2, 3, -2, 4, 5, 6, -3, 2, 9, 8, 7]), 3),
  );
  if (indexed) value.setIndex([2, 1, 0]);
  return value;
}

test('fallback collider geometry preserves signed scale and complete triangles only', () => {
  const scale = { x: -2, y: 3, z: 4 };
  for (const indexed of [false, true]) {
    const geometry = triangle(indexed);
    const result = resolveShape(geometry, scale, 'static');
    assert.equal(result.shape, SHAPE.triangles);
    assert.deepEqual([...result.vertices!], [-2, 6, 12, 4, 12, 20, -12, -9, 8, -18, 24, 28]);
    assert.deepEqual([...result.indices!], indexed ? [2, 1, 0] : [0, 1, 2]);
    assert.equal(result.triangles, 1);
    assert.deepEqual(result.size, [0, 0, 0]);
    for (const type of ['dynamic', 'kinematic'] as const) {
      const hull = resolveShape(geometry, scale, type);
      assert.equal(hull.shape, SHAPE.hull);
      assert.equal(hull.triangles, 0);
      assert.deepEqual(hull.size, [0, 0, 0]);
      assert.deepEqual(hull.vertices, result.vertices);
      assert.equal(hull.indices, undefined);
    }
    assert.equal(resolveShape(geometry, scale, 'static', { type: 'hull' }).shape, SHAPE.hull);
    assert.equal(
      resolveShape(geometry, scale, 'kinematic', { type: 'triangles' }).shape,
      SHAPE.triangles,
    );
    assert.throws(
      () => resolveShape(geometry, scale, 'dynamic', { type: 'triangles' }, 'panel'),
      (error: any) =>
        error.code === 'PHYSICS_FAILED' &&
        error.message.includes('panel') &&
        error.details.name === 'panel',
    );
  }
});

test('exact round primitives require the axes that keep them round and preserve taper', () => {
  const uniform = { x: -2, y: 2, z: -2 };
  assert.deepEqual(primitive({ type: 'sphere', radius: 3 }, uniform)?.size, [6, 0, 0]);
  assert.deepEqual(
    primitive({ type: 'capsule', radius: 3, halfHeight: 4 }, uniform)?.size,
    [8, 6, 0],
  );
  const cylinder = { type: 'cylinder', radius: 3, radiusBottom: 5, halfHeight: 4 } as const;
  assert.deepEqual(primitive(cylinder, { x: 2, y: 7, z: 2 })?.size, [28, 6, 10]);
  assert.deepEqual(primitive({ ...cylinder, radiusBottom: 3 }, uniform)?.size, [8, 6, 0]);
  assert.deepEqual(
    primitive({ type: 'cylinder', radius: 3, halfHeight: 4 }, uniform)?.size,
    [8, 6, 0],
  );
  assert.deepEqual(
    primitive({ type: 'box', halfExtents: [2, 3, 4] }, { x: -3, y: -4, z: -5 })?.size,
    [6, 12, 20],
  );
  for (const s of [
    { x: 2, y: 3, z: 2 },
    { x: 2, y: 2, z: 3 },
  ]) {
    assert.equal(primitive({ type: 'sphere', radius: 1 }, s), null);
    assert.equal(primitive({ type: 'capsule', radius: 1, halfHeight: 2 }, s), null);
  }
  assert.equal(primitive(cylinder, { x: 2, y: 2, z: 3 }), null);
});

test('recipe defaults infer native primitives while tapered recipes fall back to mesh', () => {
  const geometry = triangle(),
    scale = { x: 2, y: 2, z: 2 };
  for (const [type, args, shape, size] of [
    ['box', [], SHAPE.box, [1, 1, 1]],
    ['box', [2, 4, 6], SHAPE.box, [2, 4, 6]],
    ['sphere', [], SHAPE.sphere, [2, 0, 0]],
    ['sphere', [3], SHAPE.sphere, [6, 0, 0]],
    ['capsule', [], SHAPE.capsule, [1, 2, 0]],
    ['capsule', [3, 4], SHAPE.capsule, [4, 6, 0]],
    ['cylinder', [], SHAPE.cylinder, [1, 2, 0]],
    ['cylinder', [3, 3, 4], SHAPE.cylinder, [4, 6, 0]],
  ] as const) {
    geometry.recipe = { type, args: [...args] };
    assert.deepEqual(resolveShape(geometry, scale, 'dynamic'), {
      shape,
      size: [...size],
      triangles: 0,
    });
  }
  geometry.recipe = { type: 'cylinder', args: [1, 2, 4] };
  assert.equal(resolveShape(geometry, scale, 'dynamic').shape, SHAPE.hull);
  geometry.recipe = { type: 'unknown', args: [] };
  assert.equal(resolveShape(geometry, scale, 'static').shape, SHAPE.triangles);
});

test('compound defaults retain local turns and refuse each nonpositive or uneven scale', () => {
  const geometry = triangle(),
    quaternion = [0, 0.5, 0, 0.5];
  const declared = {
    type: 'compound',
    parts: [
      { type: 'box', halfExtents: [1, 2, 3] },
      { type: 'sphere', radius: 2, position: [3, 4, 5], quaternion },
    ],
  } as any;
  const result = resolveShape(geometry, { x: 2, y: 2, z: 2 }, 'dynamic', declared);
  assert.deepEqual(result.size, [0, 0, 0]);
  assert.deepEqual(result.parts, [
    { shape: SHAPE.box, size: [2, 4, 6], position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    { shape: SHAPE.sphere, size: [4, 0, 0], position: [6, 8, 10], quaternion },
  ]);
  for (const s of [
    { x: 0, y: 1, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 0 },
    { x: -1, y: -1, z: 1 },
    { x: 1, y: 2, z: 1 },
    { x: 1, y: 1, z: 2 },
  ])
    assert.throws(
      () => resolveShape(geometry, s, 'dynamic', declared, 'crate'),
      (error: any) =>
        error.code === 'PHYSICS_FAILED' &&
        error.message.includes('crate') &&
        error.details.name === 'crate',
    );
});
