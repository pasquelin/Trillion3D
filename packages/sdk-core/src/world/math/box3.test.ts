import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, type BoundedNode } from './box3.ts';
import { Vector3 } from './vector3.ts';
import { Sphere } from './volumes.ts';
import { Matrix4 } from './matrix4.ts';
import { Group } from '../object/object3d.ts';
import { Mesh } from '../object/mesh.ts';
import { Geometry } from '../geometry/geometry.ts';
import { BufferAttribute } from '../buffer/attribute.ts';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

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

test('box bounds preserve inclusive boundaries, reject all six outside faces and own copies', () => {
  const box = new Box3(v(-1, -2, -3), v(2, 4, 6));
  assert.equal(box.isEmpty(), false);
  assert.deepEqual(box.getCenter().toArray(), [0.5, 1, 1.5]);
  assert.deepEqual(box.getSize().toArray(), [3, 6, 9]);
  for (const point of [v(-1, -2, -3), v(2, 4, 6), v(0, 0, 0)])
    assert.equal(box.containsPoint(point), true);
  for (const point of [v(-2, 0, 0), v(3, 0, 0), v(0, -3, 0), v(0, 5, 0), v(0, 0, -4), v(0, 0, 7)]) {
    assert.equal(box.containsPoint(point), false);
    assert.equal(box.intersectsBox(new Box3(point, point.clone())), false);
  }
  assert.equal(box.intersectsBox(new Box3(v(2, 4, 6), v(7, 8, 9))), true);
  const clone = box.clone();
  assert.notEqual(clone.min, box.min);
  assert.ok(clone.equals(box));
  clone.min.x--;
  assert.equal(clone.equals(box), false);
  clone.copy(box);
  clone.max.z++;
  assert.equal(clone.equals(box), false);
  const expanded = box.clone().expandByScalar(1);
  assert.deepEqual(expanded.min.toArray(), [-2, -3, -4]);
  assert.deepEqual(expanded.max.toArray(), [3, 5, 7]);
  box.union(new Box3(v(-3, -1, -1), v(1, 5, 2)));
  assert.deepEqual(box.min.toArray(), [-3, -2, -3]);
  assert.deepEqual(box.max.toArray(), [2, 5, 6]);
  const empty = new Box3();
  assert.equal(empty.isEmpty(), true);
  assert.deepEqual(empty.getCenter().toArray(), [0, 0, 0]);
  assert.deepEqual(empty.getSize().toArray(), [0, 0, 0]);
  for (const max of [v(-1, 1, 1), v(1, -1, 1), v(1, 1, -1)])
    assert.equal(new Box3(v(0, 0, 0), max).isEmpty(), true);
});

test('point lists, transformed boxes and bounding spheres retain geometry extents', () => {
  const box = new Box3().setFromArray([1, 2, 3, 99, -4, 5, -6, 98, 2, -7, 8, 97], 4);
  assert.deepEqual(box.min.toArray(), [-4, -7, -6]);
  assert.deepEqual(box.max.toArray(), [2, 5, 8]);
  const points = new Box3().setFromPoints([v(1, 2, 3), v(-4, 5, -6), v(2, -7, 8)]);
  assert.ok(points.equals(box));
  const transformed = new Box3(v(-1, -2, -3), v(1, 2, 3)).applyMatrix4(
    new Matrix4().makeScale(-2, 3, 4).setPosition(10, 20, 30),
  );
  assert.deepEqual(transformed.min.toArray(), [8, 14, 18]);
  assert.deepEqual(transformed.max.toArray(), [12, 26, 42]);
  const sphere = new Sphere();
  new Box3(v(-3, -4, -12), v(3, 4, 12)).getBoundingSphere(sphere);
  assert.deepEqual(sphere.center.toArray(), [0, 0, 0]);
  assert.equal(sphere.radius, 13);
  box.makeEmpty();
  assert.equal(box.isEmpty(), true);
  box.getBoundingSphere(sphere);
  assert.equal(sphere.isEmpty(), true);
});
