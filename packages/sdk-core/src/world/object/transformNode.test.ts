import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from './object3d.ts';
import { Matrix4 } from '../math/matrix4.ts';

const translation = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);

test('a local matrix written in place, recomposition cut, reaches the world matrix', () => {
  const parent = new Object3D(),
    child = new Object3D();
  parent.add(child);
  parent.position.set(1, 0, 0);
  child.matrixAutoUpdate = false;
  assert.equal(child.matrixAutoUpdate, false);
  child.matrix.copy(translation(0, 2, 0));
  parent.updateMatrixWorld();
  assert.deepEqual([...child.matrixWorld.elements.slice(12, 15)], [1, 2, 0]);
  child.matrix.copy(translation(0, 3, 0));
  child.matrixWorldNeedsUpdate = true;
  child.updateMatrixWorld();
  assert.deepEqual([...child.matrixWorld.elements.slice(12, 15)], [1, 3, 0]);
  assert.equal(child.matrixWorldNeedsUpdate, false, 'the update clears the mark');
});

test('under automatic update the pose overwrites a written matrix, as the reference does', () => {
  const node = new Object3D();
  node.position.set(4, 0, 0);
  node.matrix.copy(translation(9, 9, 9));
  node.updateMatrixWorld();
  assert.deepEqual([...node.matrixWorld.elements.slice(12, 15)], [4, 0, 0]);
});

test('a matrix pointed at storage of its own keeps it', () => {
  const node = new Object3D(),
    storage = translation(5, 6, 7).elements;
  node.matrixAutoUpdate = false;
  node.matrix.elements = storage;
  storage[12] = 8;
  assert.equal(node.matrix.elements, storage);
  assert.equal(node.matrix.elements[12], 8);
});

test('updateMatrix composes now; applyMatrix4 moves the pose by the product', () => {
  const node = new Object3D();
  node.position.set(1, 2, 3);
  node.updateMatrix();
  assert.deepEqual([...node.matrix.elements.slice(12, 15)], [1, 2, 3]);
  assert.equal(node.matrixWorldNeedsUpdate, true);
  node.applyMatrix4(translation(10, 0, 0));
  assert.deepEqual([node.position.x, node.position.y, node.position.z], [11, 2, 3]);
});

test('a node posed by storage of its own places its world by it, read after read', () => {
  const parent = new Object3D(),
    node = new Object3D(),
    storage = translation(0, 1, 0).elements;
  parent.add(node);
  parent.position.set(2, 0, 0);
  parent.updateMatrixWorld();
  node.matrixAutoUpdate = false;
  node.matrix.elements = storage;
  assert.deepEqual([...node.matrixWorld.elements.slice(12, 15)], [2, 1, 0]);
  storage[13] = 5;
  assert.deepEqual([...node.matrixWorld.elements.slice(12, 15)], [2, 5, 0]);
});
