import test from 'node:test'
import assert from 'node:assert/strict'
import { camera, Camera } from '../../../../../../../packages/sdk-core/src/world/camera/index.ts'
import { Object3D } from '../../../../../../../packages/sdk-core/src/world/object/object3d.ts'
import { Vector3 } from '../../../../../../../packages/sdk-core/src/world/math/vector3.ts'
import { Ray } from '../../../../../../../packages/sdk-core/src/world/math/volumes.ts'
import { near as within } from '../../../../../../../packages/sdk-core/src/math/near.fixture.ts'
import * as THREE from 'three'

const near = (actual: ArrayLike<number>, expected: readonly number[]) =>
  within(actual, expected, 'camera', 1e-10)

test('perspective rays use the parent pose, zoom and picture aspect with normalized directions', () => {
  const parent = new Object3D()
  parent.position.set(10, 20, 30)
  const eye = camera.perspective({ fov: 90, zoom: 2 })
  eye.position.set(1, 2, 3)
  parent.add(eye)
  const ray = new Ray()
  assert.equal(eye.rayThrough(1, -1, 2, ray), ray)
  near(ray.origin.toArray(), [11, 22, 33])
  near(ray.direction.toArray(), [2 / 3, -1 / 3, -2 / 3])
  eye.set({ position: [1, 2, 3], target: [12, 22, 33], fov: 60 })
  near(eye.rayThrough(0, 0, 2).direction.toArray(), [1, 0, 0])
  eye.set({ position: [1, 2, 3], target: [11, 22, 32] })
  assert.equal(eye.fov, 60)
  near(eye.rayThrough(0, 0, 2).direction.toArray(), [0, 0, -1])
})

test('orthographic rays preserve off-centre boxes, fit aspect and zoom without perspective', () => {
  const eye = camera.orthographic({ left: 1, right: 5, bottom: 5, top: 9, zoom: 2 })
  eye.position.set(10, 20, 30)
  let ray = eye.rayThrough(1, 1, 2)
  near(ray.origin.toArray(), [14, 28, 30])
  near(ray.direction.toArray(), [0, 0, -1])
  eye.fitAspect = true
  ray = eye.rayThrough(1, -1, 2)
  near(ray.origin.toArray(), [15, 26, 30])
  near(ray.direction.toArray(), [0, 0, -1])
  eye.zoom = 1
  near(eye.rayThrough(-1, 1, 2).origin.toArray(), [9, 29, 30])
})

test('cached projections update, the near plane at reversed depth 1 and distance as near over it', () => {
  const eye = camera.perspective({ fov: 90, near: 2, far: 10, aspect: 2 })
  const matrix = eye.projectionMatrix
  near(new Vector3(4, 2, -2).applyMatrix4(matrix).toArray(), [1, 1, 1])
  near(new Vector3(0, 0, -10).applyMatrix4(matrix).toArray(), [0, 0, 0.2])
  eye.near = 1
  eye.far = 9
  eye.aspect = 1
  eye.zoom = 2
  assert.equal(eye.projectionMatrix, matrix)
  near(new Vector3(0.5, 0.5, -1).applyMatrix4(matrix).toArray(), [1, 1, 1])
  near(new Vector3(0, 0, -9).applyMatrix4(matrix).toArray(), [0, 0, 1 / 9])
  eye.position.set(3, 4, 5)
  eye.updateWorldMatrix(true, false)
  const inverse = eye.matrixWorldInverse
  near(new Vector3(3, 4, 5).applyMatrix4(inverse).toArray(), [0, 0, 0])
  eye.position.set(7, 8, 9)
  eye.updateWorldMatrix(true, false)
  assert.equal(eye.matrixWorldInverse, inverse)
  near(new Vector3(7, 8, 9).applyMatrix4(inverse).toArray(), [0, 0, 0])
})

test('camera copies isolate optics, preserve projection kind and honor child recursion', () => {
  const source = camera.orthographic({
    left: 1,
    right: 7,
    top: 8,
    bottom: 2,
    near: 3,
    far: 11,
    aspect: 2,
    zoom: 3,
    fov: 70,
    fitAspect: true,
  })
  source.add(new Object3D())
  source.position.set(1, 2, 3)
  const clone = source.clone()
  assert.ok(clone instanceof Camera)
  assert.equal(clone.projection, 'orthographic')
  assert.equal(clone.type, 'OrthographicCamera')
  assert.equal(clone.children.length, 1)
  assert.notEqual(clone.children[0], source.children[0])
  assert.deepEqual(clone._optics, source._optics)
  assert.notEqual(clone._optics, source._optics)
  assert.equal(clone.fitAspect, true)
  clone.left = -5
  assert.equal(source.left, 1)
  const target = camera.perspective()
  target.copy(source, false)
  assert.equal(target.projection, 'perspective')
  assert.equal(target.children.length, 0)
  assert.deepEqual(target._optics, source._optics)
  target.copy(new Object3D(), false)
  assert.equal(target.fov, 70)
})

test('orthographic projection maps asymmetric view corners, near at depth 1 and far at 0', () => {
  const eye = camera.orthographic({ left: 1, right: 7, top: 8, bottom: 2, near: 3, far: 11 })
  const matrix = eye.projectionMatrix
  near(new Vector3(1, 2, -3).applyMatrix4(matrix).toArray(), [-1, -1, 1])
  near(new Vector3(7, 8, -11).applyMatrix4(matrix).toArray(), [1, 1, 0])
  eye.left = -5
  eye.right = 9
  eye.top = 10
  eye.bottom = -2
  eye.near = 1
  eye.far = 5
  near(new Vector3(-5, -2, -1).applyMatrix4(matrix).toArray(), [-1, -1, 1])
  near(new Vector3(9, 10, -5).applyMatrix4(matrix).toArray(), [1, 1, 0])
  eye.zoom = 2
  near(new Vector3(-1.5, 1, -1).applyMatrix4(matrix).toArray(), [-1, -1, 1])
  near(new Vector3(5.5, 7, -5).applyMatrix4(matrix).toArray(), [1, 1, 0])
  eye.fitAspect = true
  eye.aspect = 2
  near(new Vector3(-4, 1, -1).applyMatrix4(matrix).toArray(), [-1, -1, 1])
  near(new Vector3(8, 7, -5).applyMatrix4(matrix).toArray(), [1, 1, 0])
})

test('a camera names its kind, and its default box is centred', () => {
  assert.equal(camera.perspective().type, new THREE.PerspectiveCamera().type)
  assert.equal(camera.orthographic().type, new THREE.OrthographicCamera().type)
  const box = camera.orthographic()
  assert.deepEqual([box.left + box.right, box.top + box.bottom], [0, 0])
  assert.ok(box.right > 0 && box.top > 0)
})

test('fitting the aspect, copying optics and setting a pose each recompose what is read', () => {
  const eye = camera.orthographic({ left: -1, right: 1, top: 1, bottom: -1, aspect: 2 })
  const matrix = eye.projectionMatrix
  const before = [...matrix.elements]
  eye.fitAspect = true
  assert.notDeepEqual([...matrix.elements], before, 'the box widened to the picture')
  const wide = camera.perspective({ fov: 20 })
  const lens = camera.perspective()
  const read = lens.projectionMatrix
  wide.add(new Object3D())
  lens.copy(wide)
  assert.deepEqual([...read.elements], [...wide.projectionMatrix.elements])
  assert.equal(lens.children.length, 1, 'children come along by default')
  lens.set({ position: [4, 5, 6], target: [4, 5, 0] })
  near(lens.rayThrough(0, 0, 1).origin.toArray(), [4, 5, 6])
})
