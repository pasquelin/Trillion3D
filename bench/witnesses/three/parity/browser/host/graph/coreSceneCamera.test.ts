/**
 * The engine's scene and camera are the core's `Scene` and `Camera`: a draw reads a core camera's
 * projection, the engine's own reversed depth, and the engine numbers both in its one count, with
 * no field a page's own does not carry.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Camera } from '../../../../../../../packages/sdk-core/src/world/camera/camera.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../../../../../packages/sdk-core/src/math/primitives/camera.ts'
import { Mesh } from '../../../../../../../packages/sdk-core/src/world/object/mesh.ts'
import { Object3D } from '../../../../../../../packages/sdk-core/src/world/object/object3d.ts'
import { Geometry } from '../../../../../../../packages/sdk-core/src/world/geometry/geometry.ts'
import { Scene } from '../../../../../../../packages/sdk-browser/src/world/core/scene.ts'
import {
  numbered,
  serialOf,
} from '../../../../../../../packages/sdk-browser/src/host/graph/serial.ts'
import { GraphSurface } from '../../../../../../../packages/sdk-browser/src/host/graph/surface.ts'

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

test('the engine numbers a core scene and camera in its one count; a page-built one takes none', () => {
  const scene = numbered(new Scene()),
    camera = numbered(new Camera('perspective')),
    mesh = numbered(new Mesh(new Geometry(), new GraphSurface('basic')))
  assert.equal(serialOf(camera), serialOf(scene)! + 1)
  assert.equal(serialOf(mesh), serialOf(camera)! + 1)
  assert.equal(serialOf(new Scene()), undefined)
  assert.equal(serialOf(new Camera('perspective')), undefined)
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
