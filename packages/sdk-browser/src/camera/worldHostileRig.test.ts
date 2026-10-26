// `world.ts`, `readCameraWorld` and `holdCameraWorld`, under a hostile rig: three ancestor levels,
// shear at the first, negative AND non-uniform scale at the second — nothing a TRS decomposition
// yields — and under a singular, NaN or infinite world matrix, where the engine's view is the
// identity. The PROJECTION is the engine's own, composed from the declared optics
// (`depthConvention.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBits } from '../../../../tests/kit/assert/bits.ts'
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { perspectiveProjection } from '../../../math/src/projection/camera.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { Euler } from '../../../sdk-core/src/world/math/euler.ts'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { readCameraWorld, resolveCameraWorld } from './world.ts'
import { createEngineCamera, holdCameraWorld } from './engineCamera.ts'

/** Three levels: frozen shear at the top, negative and non-uniform scale in the middle. */
function hostileRig(fov = 50, aspect = 16 / 9) {
  const grandparent = new Object3D()
  grandparent.matrixAutoUpdate = false
  // Non-orthogonal rows: y depends on x, z depends on y. Determinant 1, always invertible.
  grandparent.matrix.set(1, 0, 0, 2, 0.4, 1, 0, -3, 0, 0.25, 1, 6, 0, 0, 0, 1)
  const parent = new Object3D()
  parent.position.set(-4, 1.5, 2)
  parent.quaternion.setFromEuler(new Euler(0.4, -0.7, 0.2))
  parent.scale.set(-2, 3, 0.5) // opposite sign on x, three distinct magnitudes.
  grandparent.add(parent)
  const camera = G.perspectiveCamera(fov, aspect, 0.1, 500)
  camera.position.set(0.3, -0.2, 1.1)
  camera.rotation.set(0.05, -0.1, 0.02)
  parent.add(camera)
  return camera
}

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

test('readCameraWorld: singular world matrix, the view falls to the identity', () => {
  const camera = G.perspectiveCamera(50, 1, 0.1, 100)
  camera.matrixAutoUpdate = false
  camera.matrix.set(1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1) // third column null.
  resolveCameraWorld(camera)
  const into = readCameraWorld(createEngineCamera(), camera)
  assertBits(into.view, IDENTITY_MATRIX4)
  assertBits(into.viewProjection, perspectiveProjection(new Float64Array(16), 50, 1, 0.1, 1))
})

test('readCameraWorld: NaN, ±0 and infinities in the world matrix read as the identity view, without throwing', () => {
  const camera = G.perspectiveCamera(50, 1, 0.1, 100)
  camera.matrixAutoUpdate = false
  camera.matrix.set(Infinity, 0, 0, -0, 0, NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  resolveCameraWorld(camera)
  const into = readCameraWorld(createEngineCamera(), camera)
  assertBits(into.world, camera.matrixWorld.elements)
  assertBits(into.view, IDENTITY_MATRIX4)
  assertBits(into.viewProjection, perspectiveProjection(new Float64Array(16), 50, 1, 0.1, 1))
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
