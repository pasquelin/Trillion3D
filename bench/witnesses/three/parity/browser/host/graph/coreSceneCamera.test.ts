/**
 * The engine's scene and camera are the core's `Scene` and `Camera`: a draw reads a core camera's
 * projection, the engine's own reversed depth, with no field a page's own does not carry.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Camera } from '../../../../../../../packages/sdk-core/src/world/camera/camera.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../../../../../packages/math/src/projection/camera.ts'
import { Object3D } from '../../../../../../../packages/sdk-core/src/world/object/object3d.ts'
import { Scene } from '../../../../../../../packages/sdk-browser/src/world/core/scene.ts'

/** The projection `camera` holds, in the numbers a draw uploads. */
const drawnProjection = (camera: Camera) =>
  Array.from(new Float32Array(camera.projectionMatrix.elements))
/** A projection of the engine, in the numbers a draw uploads. */
const engine = (projection: Float64Array) => Array.from(new Float32Array(projection))

test('a core camera is drawn from: a draw reads the engine projection, kept current', () => {
  const eye = new Camera('perspective', { fov: 47, aspect: 1.6, near: 0.3, far: 900, zoom: 1.5 })
  const lens = (fov: number) => perspectiveProjection(new Float64Array(16), fov, 1.6, 0.3, 1.5)
  assert.deepEqual(drawnProjection(eye), engine(lens(47)))
  eye.fov = 30
  assert.deepEqual(drawnProjection(eye), engine(lens(30)), 'an optic write')
  const box = new Camera('orthographic', { left: -3, right: 5, top: 2, bottom: -1, far: 40 })
  const boxProjection = orthographicProjection(new Float64Array(16), -3, 5, -1, 2, 0.1, 40)
  assert.deepEqual(drawnProjection(box), engine(boxProjection))
  const witness = new THREE.PerspectiveCamera(47, 1.6, 0.3, 900)
  eye.position.set(1, -2, 4)
  eye.lookAt(3, 0, -5)
  eye.updateMatrixWorld()
  witness.position.set(1, -2, 4)
  witness.lookAt(3, 0, -5)
  witness.updateMatrixWorld()
  assert.deepEqual([...eye.matrixWorldInverse.elements], witness.matrixWorldInverse.elements)
})

test('a core scene and camera hold no field the engine needs beyond a page one', async () => {
  const base = new Set(Object.keys(new Object3D()))
  const own = (node: object) => Object.keys(node).filter((key) => !base.has(key))
  assert.deepEqual(own(new Scene()), [
    '_background',
    'recoloured',
    'environment',
    '_fog',
    'refogged',
  ])
  const camera = new Camera('perspective')
  assert.deepEqual(own(camera), ['isCamera', '_optics', '_fitAspect', 'projection'])
  void camera.projectionMatrix
  assert.deepEqual(own(camera), [
    'isCamera',
    '_optics',
    '_fitAspect',
    'projection',
    '_projectionMatrix',
  ])
  await assert.rejects(new Scene().load('model.json'), { code: 'UNSUPPORTED_SCENE_UPDATE' })
})
