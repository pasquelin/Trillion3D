import test from 'node:test';
import assert from 'node:assert/strict';
import { Skeleton, paletteReach, paletteStretch } from './skeleton.ts';
import { Object3D } from '../object/object3d.ts';
import { Matrix4 } from '../math/matrix4.ts';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

test('skeleton palettes keep joint order, explicit binds, mesh transforms and output offsets', () => {
  const a = new Object3D(),
    b = new Object3D();
  a.position.set(2, 3, 4);
  b.position.set(-4, 5, 6);
  a.updateMatrixWorld(true);
  b.updateMatrixWorld(true);
  const skeleton = new Skeleton([a, b]);
  assert.equal(skeleton.isSkeleton, true);
  assert.equal(skeleton.bones[1], b);
  assert.deepEqual([...skeleton.boneInverses.slice(12, 15)], [-2, -3, -4]);
  assert.deepEqual([...skeleton.boneInverses.slice(28, 31)], [4, -5, -6]);
  const mesh = new Matrix4().makeTranslation(1, 2, 3),
    out = new Float32Array(30).fill(99);
  assert.equal(skeleton.palette(mesh.elements, out, 3), out);
  assert.deepEqual([...out.slice(0, 3)], [99, 99, 99]);
  assert.deepEqual([...out.slice(27)], [99, 99, 99]);
  assert.deepEqual([...out.slice(3, 15)], [1, 0, 0, -1, 0, 1, 0, -2, 0, 0, 1, -3]);
  assert.deepEqual([...out.slice(15, 27)], [1, 0, 0, -1, 0, 1, 0, -2, 0, 0, 1, -3]);
  const explicit = new Skeleton([a, b], [...new Matrix4().elements, ...new Matrix4().elements, 99]);
  assert.equal(explicit.boneInverses.length, 32);
  assert.deepEqual(
    [...explicit.palette(new Matrix4().elements, new Float32Array(24)).slice(0, 12)],
    [1, 0, 0, 2, 0, 1, 0, 3, 0, 0, 1, 4],
  );
});

test('palette reach includes translated points and spheres stretched on each axis', () => {
  const translated = [1, 0, 0, 3, 0, 1, 0, 4, 0, 0, 1, 12];
  assert.equal(paletteReach(new Float32Array(translated), 0, 1, [2, 3, 4, 0]), 13);
  const stretch = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0];
  const palette = new Float32Array([99, 99, ...identity, ...stretch, ...translated]);
  assert.equal(paletteReach(palette, 2, 1, [8, 9, 10, 3]), 0);
  assert.equal(paletteReach(palette, 14, 1, [1, 2, 3, 0]), Math.sqrt(98));
  assert.ok(Math.abs(paletteReach(palette, 14, 1, [0, 0, 0, 2]) - 2 * Math.sqrt(14)) < 1e-12);
  assert.equal(paletteReach(palette, 2, 3, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 13);
  assert.equal(paletteReach(palette, 2, 3, [0, 0, 0, 0]), 0);
  assert.equal(paletteReach(palette, 2, 0, []), 0);
});

test('palette stretch bounds both shear directions and selects the largest joint', () => {
  const xShear = [1, 3, 0, 100, 0, 1, 0, -200, 0, 0, 1, 300];
  const yShear = [1, 0, 0, 0, 3, 1, 0, 0, 0, 0, 1, 0];
  for (const matrix of [xShear, yShear])
    assert.equal(paletteStretch(new Float32Array(matrix), 0, 1), 4);
  const p = new Float32Array([
    99,
    ...identity,
    ...xShear,
    ...[1, 0, 0, 0, 0, -7, 0, 0, 0, 0, 2, 0],
  ]);
  assert.equal(paletteStretch(p, 1, 3), 7);
  assert.equal(paletteStretch(p, 1, 0), 1);
  assert.equal(paletteStretch(new Float32Array(identity), 0, 1), 1);
});
