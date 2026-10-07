// `world.ts` taken function by function, confronted with an independent composition bit for bit (`Object.is`),
// under a hostile rig: three ancestor levels, shear at the first, negative AND non-uniform
// scale at the second — nothing a TRS decomposition yields. `readCameraWorld` must produce the
// same numbers as the product of the projection by the view matrix and the six planes taken from it,
// with or without a singular, NaN or infinite world matrix.
//
// The PROJECTION, for its part, is no longer the host's: the engine composes it from the
// declared optics, in reversed depth and infinite far plane (`depthConvention.ts`). The
// reference therefore receives that projection, and its six planes are the engine's with the
// last two swapped — in reversed depth, the plane that bounds near is the reference's far plane.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts'
import { perspectiveProjection } from '../../../../../../packages/sdk-core/src/index.ts'
import {
  createEngineCamera,
  enginePose,
  holdCameraWorld,
  readCameraWorld,
  resolveCameraWorld,
  type HostCamera,
} from '../../../../../../packages/sdk-browser/src/camera/world.ts'

/** Three levels: frozen shear at the top, negative and non-uniform scale in the middle. */
function hostileRig(fov = 50, aspect = 16 / 9) {
  const grandparent = new THREE.Object3D()
  grandparent.matrixAutoUpdate = false
  // Non-orthogonal rows: y depends on x, z depends on y. Determinant 1, always invertible.
  grandparent.matrix.set(1, 0, 0, 2, 0.4, 1, 0, -3, 0, 0.25, 1, 6, 0, 0, 0, 1)
  const parent = new THREE.Object3D()
  parent.position.set(-4, 1.5, 2)
  parent.quaternion.setFromEuler(new THREE.Euler(0.4, -0.7, 0.2))
  parent.scale.set(-2, 3, 0.5) // opposite sign on x, three distinct magnitudes.
  grandparent.add(parent)
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 500)
  camera.position.set(0.3, -0.2, 1.1)
  camera.rotation.set(0.05, -0.1, 0.02)
  parent.add(camera)
  return camera
}

/** The oracle camera: ancestors resolved, then a flat camera that carries the same
 *  world matrix bit for bit — its view matrix is then refreshed as the
 *  host would — and the ENGINE projection. Two effects of reversing depth on the frustum: the
 *  last two planes swap, and FAR no longer comes from the projection — infinite — but from
 *  the `far` the host declares, read from the view (a reference `Plane`, normalized like `writePlane`). */
function threeReference(camera: HostCamera) {
  resolveCameraWorld(camera)
  const { fov, aspect, near, zoom } = camera
  const flat = new THREE.PerspectiveCamera(fov, aspect, near, camera.far)
  flat.matrixAutoUpdate = false
  flat.matrix.fromArray(camera.matrixWorld.elements)
  flat.matrixWorld.copy(flat.matrix)
  const projection = perspectiveProjection(new Float64Array(16), fov, aspect, near, zoom)
  flat.projectionMatrix.fromArray([...projection])
  flat.updateMatrixWorld(true)
  const viewProjection = flat.projectionMatrix.clone().multiply(flat.matrixWorldInverse)
  const brut = new Float64Array(24)
  new THREE.Frustum()
    .setFromProjectionMatrix(viewProjection, THREE.WebGPUCoordinateSystem)
    .planes.forEach((p, i) => brut.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4))
  const planes = brut.slice()
  planes.set(brut.subarray(16, 20), 20)
  const v = flat.matrixWorldInverse.elements
  const loin = new THREE.Plane(new THREE.Vector3(v[2], v[6], v[10]), v[14] + camera.far).normalize()
  planes.set([loin.normal.x, loin.normal.y, loin.normal.z, loin.constant], 16)
  const eye = new THREE.Vector3().fromArray(camera.matrixWorld.elements, 12)
  return { view: flat.matrixWorldInverse, viewProjection, planes, projection, eye }
}

test('readCameraWorld under a hostile rig (shear, negative non-uniform scale), WebGPU convention', () => {
  const camera = hostileRig()
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem
  camera.updateProjectionMatrix()
  const ref = threeReference(camera)
  const into = readCameraWorld(createEngineCamera(), camera)
  assertBits(into.world, camera.matrixWorld.elements)
  // The engine projection is its own, composed from the declared optics, never the host's.
  assertBits(into.projection, ref.projection)
  assertBits(into.view, ref.view.elements)
  assertBits(into.viewProjection, ref.viewProjection.elements)
  assertBits(into.planes, ref.planes)
  assertBits(into.eye, ref.eye.toArray())
})

test('readCameraWorld: idempotent, and the second read allocates no new buffer', () => {
  const camera = hostileRig()
  const into = createEngineCamera()
  readCameraWorld(into, camera)
  const { world, view, viewProjection, planes, eye } = into
  const firstRead = [...world, ...view, ...viewProjection, ...planes, ...eye]
  readCameraWorld(into, camera) // nothing has moved: same camera, same rig.
  assert.equal(into.world, world, 'same `world` buffer')
  assert.equal(into.view, view, 'same `view` buffer')
  assert.equal(into.viewProjection, viewProjection, 'same `viewProjection` buffer')
  assert.equal(into.planes, planes, 'same `planes` buffer')
  assert.equal(into.eye, eye, 'same `eye` buffer')
  const secondRead = [
    ...into.world,
    ...into.view,
    ...into.viewProjection,
    ...into.planes,
    ...into.eye,
  ]
  assert.deepEqual(secondRead, firstRead, 'and the same bits, float for float')
})

test('readCameraWorld: singular world matrix, the view falls to zero', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.matrixAutoUpdate = false
  camera.matrix.set(1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1) // third column null.
  const ref = threeReference(camera)
  const into = readCameraWorld(createEngineCamera(), camera)
  assertBits(into.view, ref.view.elements)
  assert.deepEqual([...into.view], new Array(16).fill(0), 'null matrix')
  assertBits(into.viewProjection, ref.viewProjection.elements)
})

test('readCameraWorld: NaN, ±0 and infinities propagate, without throwing', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.matrixAutoUpdate = false
  camera.matrix.set(Infinity, 0, 0, -0, 0, NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  const ref = threeReference(camera)
  const into = readCameraWorld(createEngineCamera(), camera)
  assertBits(into.world, camera.matrixWorld.elements)
  assertBits(into.view, ref.view.elements)
  assertBits(into.viewProjection, ref.viewProjection.elements)
  assert.ok(
    Number.isNaN(into.viewProjection[5]) || Number.isNaN(into.view[5]),
    'the NaN does reach the view',
  )
})

test('holdCameraWorld: bit-for-bit copy, independent of the source modified afterwards', () => {
  const camera = hostileRig()
  const source = readCameraWorld(createEngineCamera(), camera)
  const held = holdCameraWorld(createEngineCamera(), source)
  for (const field of ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'] as const)
    assertBits(held[field], source[field])
  assert.deepEqual(
    [held.near, held.far, held.fov, held.aspect],
    [source.near, source.far, source.fov, source.aspect],
  )
  // The source is rewritten by a later frame: the frozen copy must not move.
  const prior = [...held.world]
  camera.position.set(99, -50, 12)
  readCameraWorld(source, camera)
  assert.notDeepEqual([...source.world], prior, 'witness: the source did change')
  assert.deepEqual([...held.world], prior, 'the frozen copy remains that of before the new frame')
})

test('enginePose: position equals getWorldPosition, under the same hostile rig (depth 3, shear, negative non-uniform scale)', () => {
  const camera = hostileRig()
  const expected = resolveCameraWorld(camera).getWorldPosition(new THREE.Vector3())
  const actual = enginePose(readCameraWorld(createEngineCamera(), camera))
  assertBits(actual.position, expected.toArray())
})

test('enginePose: quaternion equals getWorldQuaternion, under the same hostile rig (to normalisation rounding)', () => {
  const camera = hostileRig()
  const expected = resolveCameraWorld(camera).getWorldQuaternion(new THREE.Quaternion())
  const actual = enginePose(readCameraWorld(createEngineCamera(), camera))
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, i) =>
      close(actual.quaternion[i], (expected as unknown as Record<string, number>)[k]),
    ),
    `quaternion ${actual.quaternion} !== ${expected.toArray()}`,
  )
  // Witness: under this rig, the camera's local pose is neither the published position nor orientation.
  assert.notDeepEqual(actual.position, camera.position.toArray())
})

test('enginePose: replays the same host camera, parentless twin — same position, same quaternion as the posed camera', () => {
  // A flat camera, with no ancestor, discriminates: if `enginePose` read the LOCAL pose instead of
  // the translation of `world`, it would still coincide with the oracle here, hiding the defect that
  // the previous test, for its part, catches under a rig.
  const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.5, 200)
  camera.position.set(-8, 4.5, 13.25)
  camera.rotation.set(-0.3, 1.1, 0.4)
  camera.updateProjectionMatrix()
  const expectedP = resolveCameraWorld(camera).getWorldPosition(new THREE.Vector3())
  const expectedQ = camera.getWorldQuaternion(new THREE.Quaternion())
  const actual = enginePose(readCameraWorld(createEngineCamera(), camera))
  assertBits(actual.position, expectedP.toArray())
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, i) =>
      close(actual.quaternion[i], (expectedQ as unknown as Record<string, number>)[k]),
    ),
  )
})
