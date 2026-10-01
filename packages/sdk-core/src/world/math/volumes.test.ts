import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from './box3.ts';
import { Sphere, Plane, Ray, Triangle, Frustum } from './volumes.ts';
import { Vector3 } from './vector3.ts';
import { Matrix4 } from './matrix4.ts';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

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
