import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from './object3d.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { Vector3 } from '../math/vector3.ts';
import { updateTransformTree } from '../../math/transform-tree/pass.ts';

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

test('under automatic update the pose overwrites a written matrix, as a plain host node does', () => {
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

test('a node is unnamed until named, and a cleared update flag reads cleared', () => {
  const node = new Object3D();
  assert.ok(!node.name);
  node.matrixWorldNeedsUpdate = true;
  assert.equal(node.matrixWorldNeedsUpdate, true);
  node.matrixWorldNeedsUpdate = false;
  assert.equal(node.matrixWorldNeedsUpdate, false);
});

test('localToWorld and worldToLocal take the parent where it stands now', () => {
  const parent = new Object3D(),
    child = new Object3D();
  parent.add(child);
  child.position.set(0, 1, 0);
  parent.updateMatrixWorld(true);
  parent.position.set(10, 0, 0);
  assert.deepEqual(child.localToWorld(new Vector3(0, 0, 1)).toArray(), [10, 1, 1]);
  parent.position.set(20, 0, 0);
  assert.deepEqual(child.worldToLocal(new Vector3(20, 1, 1)).toArray(), [0, 0, 1]);
});

test('a matrix taken before its tree grows still writes the node', () => {
  const root = new Object3D(),
    child = new Object3D();
  root.add(child);
  child.matrixAutoUpdate = false;
  child.matrix.copy(translation(0, 0, 0));
  for (let i = 0; i < 300; i++) root.add(new Object3D());
  child.matrix.copy(translation(1, 2, 3));
  root.updateMatrixWorld(true);
  assert.deepEqual(child.getWorldPosition().toArray(), [1, 2, 3]);
});

test('a destroyed node refuses to compose its world', () => {
  const node = new Object3D();
  node.destroy();
  assert.throws(() => node.updateMatrixWorld(), { code: 'STALE_SCENE_NODE' });
});

test('a node posed by storage of its own reads its world against its tree as last composed', () => {
  const parent = new Object3D(),
    node = new Object3D(),
    leaf = new Object3D();
  parent.add(node);
  node.add(leaf);
  parent.updateMatrixWorld();
  node.matrixAutoUpdate = false;
  node.matrix.elements = translation(0, 1, 0).elements;
  parent.position.set(9, 0, 0);
  assert.deepEqual(
    [...node.matrixWorld.elements.slice(12, 15)],
    [0, 1, 0],
    'the parent not composed yet',
  );
  assert.deepEqual([...leaf.matrixWorld.elements.slice(12, 15)], [0, 0, 0], 'nor the leaf');
  parent.updateMatrixWorld();
  assert.deepEqual([...leaf.matrixWorld.elements.slice(12, 15)], [9, 1, 0]);
});

test("a world read takes an ancestor's matrix storage of its own, as the ancestor's own read does", () => {
  const parent = new Object3D(),
    child = new Object3D();
  parent.add(child);
  child.position.set(1, 0, 0);
  parent.matrixAutoUpdate = false;
  const own = translation(0, 5, 0).elements;
  parent.matrix.elements = own;
  assert.deepEqual(child.getWorldPosition().toArray(), [1, 5, 0]);
  own[13] = 7; // written in place, behind every getter
  assert.deepEqual(child.getWorldPosition().toArray(), [1, 7, 0]);
  child.updateWorldMatrix(true, false);
  assert.equal(child.matrixWorld.elements[13], 7);
});

test('a node posed by storage of its own takes the matrix the engine sets, and reads list nothing', () => {
  const parent = new Object3D(),
    node = new Object3D();
  parent.position.set(0, 2, 0);
  node.matrixAutoUpdate = false;
  const own = translation(1, 0, 0).elements;
  node.matrix.elements = own;
  parent.attach(node); // the engine sets the local matrix that keeps its world
  assert.equal(own[13], -2, 'the storage holds it');
  assert.deepEqual(node.getWorldPosition().toArray(), [1, 0, 0], 'no jump');
  const tree = Object3D._treeOf(node);
  node.updateWorldMatrix(true, false);
  updateTransformTree(tree);
  node.getWorldPosition();
  assert.equal(updateTransformTree(tree), 0, 'a read of unchanged storage lists nothing');
});

test('storage of its own, plain or typed, is the pose once recomposition is cut, children included', () => {
  const root = new Object3D(),
    node = new Object3D(),
    child = new Object3D();
  root.add(node);
  node.add(child);
  child.position.set(0, 1, 0);
  updateTransformTree(Object3D._treeOf(root));
  node.matrix.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 1] as never;
  node.matrixAutoUpdate = false; // the storage is the pose from now on
  updateTransformTree(Object3D._treeOf(root));
  assert.deepEqual([...child.matrixWorld.elements.slice(12, 15)], [7, 1, 0]);
  const parent = new Object3D();
  parent.position.set(0, 0, 3);
  parent.attach(node); // a plain array takes the engine's matrix too
  assert.deepEqual(node.getWorldPosition().toArray(), [7, 0, 0]);
});
