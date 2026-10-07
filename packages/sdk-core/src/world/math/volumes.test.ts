import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3 } from './box3.ts'
import { Sphere, Plane, Ray, Triangle, Frustum } from './volumes.ts'
import { Vector3 } from './vector3.ts'
import { Matrix4 } from './matrix4.ts'
import { camera } from '../camera/index.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

test('spheres, planes and triangles return independently known distances and areas', () => {
  const sphere = new Sphere(v(3, 4, 5), 2)
  assert.equal(sphere.containsPoint(v(5, 4, 5)), true)
  assert.equal(sphere.containsPoint(v(5.1, 4, 5)), false)
  assert.equal(sphere.distanceToPoint(v(3, 4, 5)), -2)
  assert.equal(sphere.distanceToPoint(v(3, 4, 10)), 3)
  const copied = sphere.clone().set(v(1, 2, 3), 4)
  assert.equal(sphere.radius, 2)
  assert.notEqual(copied.center, sphere.center)
  const plane = new Plane().setFromNormalAndCoplanarPoint(v(0, 1, 0), v(3, 2, 5))
  assert.equal(plane.constant, -2)
  assert.equal(plane.distanceToPoint(v(4, 7, 9)), 5)
  assert.deepEqual(plane.projectPoint(v(4, 7, 9)).toArray(), [4, 2, 9])
  assert.equal(
    plane
      .clone()
      .set(v(0, 0, 1), -3)
      .distanceToPoint(v(0, 0, 5)),
    2,
  )
  assert.deepEqual(plane.normal.toArray(), [0, 1, 0])
  const triangle = new Triangle().set(v(0, 0, 0), v(6, 0, 0), v(0, 3, 0))
  assert.equal(triangle.getArea(), 9)
  assert.deepEqual(triangle.getNormal().toArray(), [0, 0, 1])
  assert.deepEqual(triangle.getMidpoint().toArray(), [2, 1, 0])
})

test('rays handle forward, backward, parallel, coplanar and interior intersections', () => {
  const plane = new Plane(v(0, 1, 0), -2)
  assert.equal(new Ray(v(0, 0, 0), v(0, 1, 0)).distanceToPlane(plane), 2)
  assert.equal(new Ray(v(0, 3, 0), v(0, 1, 0)).distanceToPlane(plane), null)
  assert.equal(new Ray(v(0, 2, 0), v(1, 0, 0)).distanceToPlane(plane), 0)
  assert.equal(new Ray(v(0, 0, 0), v(1, 0, 0)).distanceToPlane(plane), null)
  const box = new Box3(v(-1, -1, -1), v(1, 1, 1))
  for (const axis of [0, 1, 2]) {
    const origin = [-3, -3, -3],
      direction = [1, 1, 1]
    origin[axis] = 3
    direction[axis] = -1
    const point = new Ray(new Vector3(...origin), new Vector3(...direction)).intersectBox(box)
    const expected = [-1, -1, -1]
    expected[axis] = 1
    assert.deepEqual(point?.toArray(), expected)
  }
  assert.deepEqual(new Ray(v(0, 0, 0), v(1, 1, 1)).intersectBox(box)?.toArray(), [1, 1, 1])
  assert.equal(new Ray(v(3, 3, 3), v(1, 1, 1)).intersectBox(box), null)
  const ray = new Ray().set(v(1, 2, 3), v(4, 5, 6))
  assert.deepEqual(ray.at(2).toArray(), [9, 12, 15])
  const clone = ray.clone()
  clone.origin.x++
  assert.equal(ray.origin.x, 1)
  assert.notEqual(clone.direction, ray.direction)
})

test('frustum containment covers each plane and inclusive box intersection', () => {
  const value = new Frustum().setFromProjectionMatrix(new Matrix4())
  assert.equal(value.containsPoint(v(0, 0, 0)), true)
  for (const point of [v(-2, 0, 0), v(2, 0, 0), v(0, -2, 0), v(0, 2, 0), v(0, 0, -2), v(0, 0, 2)]) {
    assert.equal(value.containsPoint(point), false)
    assert.equal(value.intersectsBox(new Box3(point, point.clone())), false)
  }
  assert.equal(value.intersectsBox(new Box3(v(-0.5, -0.5, -0.5), v(0.5, 0.5, 0.5))), true)
})

test('a ball of radius zero is a point, not empty; set moves the centre too', () => {
  assert.equal(new Sphere(v(1, 2, 3), 0).isEmpty(), false)
  assert.equal(new Sphere(v(1, 2, 3), 2).isEmpty(), false)
  assert.equal(new Sphere().isEmpty(), true)
  assert.deepEqual(new Sphere().set(v(4, 5, 6), 1).center.toArray(), [4, 5, 6])
  const t = new Triangle().set(v(1, 1, 0), v(3, 1, 0), v(1, 4, 0))
  assert.deepEqual(t.a.toArray(), [1, 1, 0])
  assert.equal(t.getArea(), 3)
})

test('a ray measures in its own direction units, from on the plane, and grazes or starts on a box', () => {
  const plane = new Plane(v(0, 1, 0), -2)
  assert.equal(
    new Ray(v(0, 0, 0), v(0, 2, 0)).distanceToPlane(plane),
    1,
    'twice as fast, half as far',
  )
  assert.ok(new Ray(v(0, 2, 0), v(0, 1, 1)).distanceToPlane(plane) === 0, 'starting on it')
  const box = new Box3(v(-1, -1, -1), v(1, 1, 1))
  assert.deepEqual(
    new Ray(v(0, 2, 0), v(1, -1, 0)).intersectBox(box)?.toArray(),
    [1, 1, 0],
    'grazing an edge',
  )
  assert.deepEqual(
    new Ray(v(-1, 0, 0), v(1, 0, 0)).intersectBox(box)?.toArray(),
    [-1, 0, 0],
    'starting on a face',
  )
})

test('a default ray looks where an unturned camera looks', () => {
  const ahead = camera.perspective().rayThrough(0, 0, 1).direction
  near(new Ray().direction.toArray(), ahead.toArray(), 'ahead', 1e-12)
})

// Clip space keeps x and y in [-1, 1] and depth in [0, 1]: moved by (½, ½, ¼), the box is
// [-1.5, 0.5] across, [-0.25, 0.75] deep — off centre on every axis.
test('an off-centre frustum holds what its planes enclose, on every axis', () => {
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().makeTranslation(0.5, 0.5, 0.25),
  )
  assert.equal(frustum.containsPoint(v(-1.2, -1.2, 0.6)), true)
  for (const outside of [v(-1.2, 1.2, 0.6), v(-1.2, -1.2, -0.6), v(1.2, -1.2, 0.6)])
    assert.equal(frustum.containsPoint(outside), false)
})

test('a ray along a face plane of a box enters it at the box, or misses it beside the box', () => {
  const box = new Box3(v(0, 0, 0), v(1, 1, 1))
  const along = (z: number) => new Ray(v(-5, 0, z), v(1, 0, 0)).intersectBox(box)?.toArray()
  assert.deepEqual(along(0.5), [0, 0, 0.5], 'entry at t = 5, not the exit at t = 6')
  assert.equal(along(2), undefined, 'beside the box: no hit')
  assert.deepEqual(new Ray(v(0.5, 0, 0.5), v(1, 0, 0)).intersectBox(box)?.toArray(), [1, 0, 0.5])
})
