import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, type BoundedNode } from './box3.ts';
import { Vector3 } from './vector3.ts';
import { Matrix4 } from './matrix4.ts';
import { Group } from '../object/object3d.ts';
import { Mesh } from '../object/mesh.ts';
import { Geometry } from '../geometry/geometry.ts';
import { BufferAttribute } from '../buffer/attribute.ts';

test('point and array bounds reset previous extents and ignore incomplete trailing coordinates', () => {
  const box = new Box3();
  box.expandByPoint(new Vector3(2, 3, 4));
  assert.equal(box.isEmpty(), false);
  assert.deepEqual(box.min.toArray(), [2, 3, 4]);
  assert.deepEqual(box.max.toArray(), [2, 3, 4]);
  box.expandByScalar(100);
  box.setFromPoints([new Vector3(2, 3, 4), new Vector3(4, 7, 10)]);
  assert.deepEqual(box.min.toArray(), [2, 3, 4]);
  assert.deepEqual(box.max.toArray(), [4, 7, 10]);
  box.setFromArray([1, 2, 3, 9, 10]);
  assert.deepEqual(box.min.toArray(), [1, 2, 3]);
  assert.deepEqual(box.max.toArray(), [1, 2, 3]);
  box.makeEmpty();
  box.expandByPoint(new Vector3(-4, -5, -6));
  assert.deepEqual(box.min.toArray(), [-4, -5, -6]);
  assert.deepEqual(box.max.toArray(), [-4, -5, -6]);
});

test('world bounds refresh transforms, preserve local geometry and skip empty nodes', () => {
  const shape = new Geometry();
  shape.setAttribute('position', new BufferAttribute(new Float32Array([-1, -2, -3, 1, 2, 3]), 3));
  const child = new Mesh(shape),
    root = new Group();
  root.position.set(10, 20, 30);
  child.position.set(3, 4, 5);
  child.scale.set(2, 1, 1);
  root.add(child, new Mesh(new Geometry()));
  const bounds = new Box3(new Vector3(-100, -100, -100), new Vector3(100, 100, 100));
  assert.ok(bounds.setFromObject(root) === bounds);
  assert.deepEqual(bounds.min.toArray(), [11, 22, 32]);
  assert.deepEqual(bounds.max.toArray(), [15, 26, 38]);
  assert.deepEqual(shape.boundingBox!.min.toArray(), [-1, -2, -3]);
  assert.deepEqual(shape.boundingBox!.max.toArray(), [1, 2, 3]);
  root.matrixAutoUpdate = false;
  root.updateMatrixWorld(true);
  root.matrix.elements[12] = 40;
  bounds.setFromObject(root);
  assert.deepEqual(bounds.min.toArray(), [41, 22, 32]);
  assert.deepEqual(bounds.max.toArray(), [45, 26, 38]);
  root.clear();
  bounds.setFromObject(root);
  assert.equal(bounds.isEmpty(), true);
  const bare: BoundedNode = {
    matrixWorld: new Matrix4(),
    updateMatrixWorld() {},
    traverse(fn) {
      fn(bare);
    },
  };
  assert.doesNotThrow(() => bounds.setFromObject(bare));
  assert.equal(bounds.isEmpty(), true);
});

test('touching faces intersect on every axis and the enclosing sphere updates its destination', () => {
  const box = new Box3(new Vector3(1, 2, 3), new Vector3(3, 6, 9));
  for (const axis of ['x', 'y', 'z'] as const) {
    const touching = box.clone();
    touching.max[axis] = box.min[axis];
    touching.min[axis] -= 2;
    assert.equal(box.intersectsBox(touching), true);
    touching.max[axis] -= 0.25;
    assert.equal(box.intersectsBox(touching), false);
  }
  const sphere = { center: new Vector3(91, 92, 93), radius: 99 };
  assert.ok(box.getBoundingSphere(sphere) === sphere);
  assert.deepEqual(sphere.center.toArray(), [2, 4, 6]);
  assert.equal(sphere.radius, Math.sqrt(14));
});
