/**
 * The engine's scene and camera are the core's `Scene` and `Camera`: a draw reads a core camera's
 * projection, the engine's own reversed depth, with no field a page's own does not carry.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera } from '../../../../../sdk-core/src/world/camera/camera.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../../../math/src/projection/camera.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { Scene } from '../../../session/world/scene.ts'

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
  // `fitAspect` is on by default (the width follows the picture); the box as given asks it off.
  const box = new Camera('orthographic', {
    left: -3,
    right: 5,
    top: 2,
    bottom: -1,
    far: 40,
    fitAspect: false,
  })
  const boxProjection = orthographicProjection(new Float64Array(16), -3, 5, -1, 2, 0.1, 40)
  assert.deepEqual(drawnProjection(box), engine(boxProjection))
})

test('a core scene and camera hold no field the engine needs beyond a page one', async () => {
  const base = new Set(Object.keys(new Object3D()))
  const own = (node: object) => Object.keys(node).filter((key) => !base.has(key))
  // The fog, the air and the sky light are the sky module's one part (`scene.sky`).
  assert.deepEqual(own(new Scene()), ['_background', 'recoloured', 'environment', '_sky'])
  const camera = new Camera('perspective')
  // The view's set — its clip plane, its hidden and shown objects — is the camera's own (`_set`), the point
  // it frames its `viewTarget`.
  assert.deepEqual(own(camera), [
    'isCamera',
    '_optics',
    '_fitAspect',
    '_set',
    'viewTarget',
    'projection',
  ])
  void camera.projectionMatrix
  assert.deepEqual(own(camera), [
    'isCamera',
    '_optics',
    '_fitAspect',
    '_set',
    'viewTarget',
    'projection',
    '_projectionMatrix',
  ])
  await assert.rejects(new Scene().load('model.json'), { code: 'UNSUPPORTED_SCENE_UPDATE' })
})
