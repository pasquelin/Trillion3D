import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from './box3.ts';
import { Sphere, Plane, Ray, Triangle, Frustum } from './volumes.ts';
import { Vector3 } from './vector3.ts';
import { Matrix4 } from './matrix4.ts';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

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

test('spheres, planes and triangles return independently known distances and areas', () => {
  const sphere = new Sphere(v(3, 4, 5), 2);
  assert.equal(sphere.containsPoint(v(5, 4, 5)), true);
  assert.equal(sphere.containsPoint(v(5.1, 4, 5)), false);
  assert.equal(sphere.distanceToPoint(v(3, 4, 5)), -2);
  assert.equal(sphere.distanceToPoint(v(3, 4, 10)), 3);
  const copied = sphere.clone().set(v(1, 2, 3), 4);
  assert.equal(sphere.radius, 2);
  assert.notEqual(copied.center, sphere.center);
  const plane = new Plane().setFromNormalAndCoplanarPoint(v(0, 1, 0), v(3, 2, 5));
  assert.equal(plane.constant, -2);
  assert.equal(plane.distanceToPoint(v(4, 7, 9)), 5);
  assert.deepEqual(plane.projectPoint(v(4, 7, 9)).toArray(), [4, 2, 9]);
  assert.equal(
    plane
      .clone()
      .set(v(0, 0, 1), -3)
      .distanceToPoint(v(0, 0, 5)),
    2,
  );
  assert.deepEqual(plane.normal.toArray(), [0, 1, 0]);
  const triangle = new Triangle().set(v(0, 0, 0), v(6, 0, 0), v(0, 3, 0));
  assert.equal(triangle.getArea(), 9);
  assert.deepEqual(triangle.getNormal().toArray(), [0, 0, 1]);
  assert.deepEqual(triangle.getMidpoint().toArray(), [2, 1, 0]);
});

test('rays handle forward, backward, parallel, coplanar and interior intersections', () => {
  const plane = new Plane(v(0, 1, 0), -2);
  assert.equal(new Ray(v(0, 0, 0), v(0, 1, 0)).distanceToPlane(plane), 2);
  assert.equal(new Ray(v(0, 3, 0), v(0, 1, 0)).distanceToPlane(plane), null);
  assert.equal(new Ray(v(0, 2, 0), v(1, 0, 0)).distanceToPlane(plane), 0);
  assert.equal(new Ray(v(0, 0, 0), v(1, 0, 0)).distanceToPlane(plane), null);
  const box = new Box3(v(-1, -1, -1), v(1, 1, 1));
  for (const axis of [0, 1, 2]) {
    const origin = [-3, -3, -3],
      direction = [1, 1, 1];
    origin[axis] = 3;
    direction[axis] = -1;
    const point = new Ray(new Vector3(...origin), new Vector3(...direction)).intersectBox(box);
    const expected = [-1, -1, -1];
    expected[axis] = 1;
    assert.deepEqual(point?.toArray(), expected);
  }
  assert.deepEqual(new Ray(v(0, 0, 0), v(1, 1, 1)).intersectBox(box)?.toArray(), [1, 1, 1]);
  assert.equal(new Ray(v(3, 3, 3), v(1, 1, 1)).intersectBox(box), null);
  const ray = new Ray().set(v(1, 2, 3), v(4, 5, 6));
  assert.deepEqual(ray.at(2).toArray(), [9, 12, 15]);
  const clone = ray.clone();
  clone.origin.x++;
  assert.equal(ray.origin.x, 1);
  assert.notEqual(clone.direction, ray.direction);
});

test('frustum containment covers each plane and inclusive box intersection', () => {
  const value = new Frustum().setFromProjectionMatrix(new Matrix4());
  assert.equal(value.containsPoint(v(0, 0, 0)), true);
  for (const point of [v(-2, 0, 0), v(2, 0, 0), v(0, -2, 0), v(0, 2, 0), v(0, 0, -2), v(0, 0, 2)]) {
    assert.equal(value.containsPoint(point), false);
    assert.equal(value.intersectsBox(new Box3(point, point.clone())), false);
  }
  assert.equal(value.intersectsBox(new Box3(v(-0.5, -0.5, -0.5), v(0.5, 0.5, 0.5))), true);
});
