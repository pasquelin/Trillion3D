import test from 'node:test';
import assert from 'node:assert/strict';
import { math, Vector3 } from './index.ts';
import { near as within } from '../../math/near.fixture.ts';

test('math factories preserve inputs and return useful independently owned values', () => {
  assert.deepEqual(math.vector2(2, 3).toArray(), [2, 3]);
  assert.deepEqual(math.vector3(2, 3, 4).toArray(), [2, 3, 4]);
  assert.deepEqual(math.vector4(2, 3, 4, 5).toArray(), [2, 3, 4, 5]);
  assert.deepEqual(math.quaternion(0.5, -0.5, 0.5, -0.5).toArray(), [0.5, -0.5, 0.5, -0.5]);
  const euler = math.euler(0.2, 0.3, 0.4, 'ZYX');
  assert.deepEqual([euler.x, euler.y, euler.z, euler.order], [0.2, 0.3, 0.4, 'ZYX']);
  const spherical = math.spherical(4, 0.2, 0.3);
  assert.deepEqual([spherical.radius, spherical.phi, spherical.theta], [4, 0.2, 0.3]);
  const identity = math.matrix4();
  assert.deepEqual(new Vector3(2, 3, 4).applyMatrix4(identity).toArray(), [2, 3, 4]);
  assert.deepEqual(new Vector3(2, 3, 4).applyMatrix3(math.matrix3()).toArray(), [2, 3, 4]);
  assert.deepEqual(math.color([0.25, 0.5, 0.75]).toArray(), [0.25, 0.5, 0.75]);
  const frustum = math.frustum().setFromProjectionMatrix(identity);
  assert.equal(frustum.containsPoint(new Vector3(0, 0, 0)), true);
  assert.equal(frustum.containsPoint(new Vector3(2, 0, 0)), false);
});

test('geometric factories copy caller vectors and retain their own bounds', () => {
  const a = new Vector3(1, 2, 3),
    b = new Vector3(4, 5, 6),
    c = new Vector3(7, 8, 9);
  const box = math.box3(a, b),
    sphere = math.sphere(a, 7),
    plane = math.plane(a, 8);
  const ray = math.ray(a, b),
    triangle = math.triangle(a, b, c);
  a.set(20, 30, 40);
  b.set(50, 60, 70);
  c.set(80, 90, 100);
  assert.deepEqual(box.min.toArray(), [1, 2, 3]);
  assert.deepEqual(box.max.toArray(), [4, 5, 6]);
  assert.deepEqual(sphere.center.toArray(), [1, 2, 3]);
  assert.equal(sphere.radius, 7);
  assert.deepEqual(plane.normal.toArray(), [1, 2, 3]);
  assert.equal(plane.constant, 8);
  assert.deepEqual(ray.origin.toArray(), [1, 2, 3]);
  assert.deepEqual(ray.direction.toArray(), [4, 5, 6]);
  assert.deepEqual(
    [triangle.a.toArray(), triangle.b.toArray(), triangle.c.toArray()],
    [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ],
  );
  assert.ok(math.box3().isEmpty());
  assert.equal(math.sphere().isEmpty(), true);
  assert.ok(math.plane().normal.length() > 0);
  assert.ok(math.ray().direction.length() > 0);
  assert.equal(math.triangle().getArea(), 0);
});

test('curve factories preserve endpoints and degree conversion produces known rotations', () => {
  const points: [number, number, number][] = [
    [1, 2, 3],
    [2, 3, 4],
    [5, 6, 7],
  ];
  const curve = math.curve(points),
    closed = math.curve(points, true);
  assert.deepEqual(curve.getPoint(0).toArray(), [1, 2, 3]);
  assert.deepEqual(curve.getPoint(1).toArray(), [5, 6, 7]);
  assert.deepEqual(closed.getPoint(1).toArray(), [1, 2, 3]);
  const path = math.path([
    [0, 0],
    [3, 0],
    [3, 4],
  ]);
  within(path.getPoint(3 / 7).toArray(), [3, 0, 0], 'the corner, three sevenths along', 1e-12);
  assert.deepEqual(path.getPoint(1).toArray(), [3, 4, 0]);
  assert.equal(
    math
      .shape([
        [0, 0],
        [2, 0],
        [0, 2],
      ])
      .getPoints().length,
    3,
  );
  assert.equal(math.lerp(2, 10, 0.25), 4);
  assert.ok(Math.abs(Math.sin(math.degToRad(30)) - 0.5) < 1e-12);
  assert.equal(math.radToDeg(Math.PI / 2), 90);
});
