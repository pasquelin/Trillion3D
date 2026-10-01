import test from 'node:test';
import assert from 'node:assert/strict';
import { InstancedMesh } from './instancedMesh.ts';
import { Mesh } from './mesh.ts';
import { Geometry } from '../geometry/geometry.ts';
import { Material } from '../material/material.ts';

const placed = (capacity: number, count = capacity, first = 1) => {
  const mesh = new InstancedMesh(new Geometry(), new Material('meshBasic'), capacity);
  mesh.instanceMatrix.array.forEach((_, i, array) => (array[i] = i + first));
  mesh.count = count;
  return mesh;
};

test('an instanced mesh holds sixteen numbers per placement and draws them all at first', () => {
  const mesh = new InstancedMesh(new Geometry(), new Material('meshBasic'), 3);
  assert.equal(mesh.isInstancedMesh, true);
  assert.equal('isInstancedMesh' in new Mesh(), false, 'a plain mesh is not told apart as one');
  assert.equal(mesh.instanceMatrix.count, 3);
  assert.equal(mesh.instanceMatrix.array.length, 3 * 16);
  assert.equal(mesh.count, 3);
});

test('a clone keeps the capacity, the matrices and the count drawn', () => {
  const source = placed(2, 1);
  const clone = source.clone();
  assert.ok(clone instanceof InstancedMesh);
  assert.notEqual(clone.instanceMatrix, source.instanceMatrix);
  assert.deepEqual(clone.instanceMatrix.array, source.instanceMatrix.array);
  assert.equal(clone.count, 1);
});

test('a copy takes the matrices that fit, asks for an upload, and draws no more than it holds', () => {
  const small = placed(1),
    big = placed(3, 3, 101);
  const version = small.instanceMatrix.version;
  big.position.set(1, 2, 3);
  small.copy(big);
  assert.deepEqual(small.position.toArray(), [1, 2, 3], 'and the pose, like any mesh');
  assert.deepEqual(
    Array.from(small.instanceMatrix.array),
    Array.from(big.instanceMatrix.array).slice(0, 16),
  );
  assert.ok(small.instanceMatrix.version > version, 'the new matrices are sent');
  assert.equal(small.count, 1, 'never past its own capacity');
  const roomy = placed(3);
  roomy.copy(placed(3, 2));
  assert.equal(roomy.count, 2, 'the count the source drew');
});

test('a copy of a plain mesh keeps the placements it had', () => {
  const mesh = placed(2, 1);
  const before = Array.from(mesh.instanceMatrix.array),
    version = mesh.instanceMatrix.version;
  mesh.copy(new Mesh());
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), before);
  assert.equal(mesh.instanceMatrix.version, version);
  assert.equal(mesh.count, 1);
});

test('dispose runs each release hook once', () => {
  const mesh = placed(1);
  let released = 0;
  mesh.released.add(() => released++);
  mesh.dispose();
  mesh.dispose();
  assert.equal(released, 1);
});
