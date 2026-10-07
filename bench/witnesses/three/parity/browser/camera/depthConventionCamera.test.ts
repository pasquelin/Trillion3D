// THE ENGINE DEPTH CONTRACT, checked end to end.
//
// The engine carries one convention: the projection is composed by the engine
// (`perspectiveProjection`), in REVERSED depth and infinite far plane — near at 1, infinity at 0 —
// and `depthConvention.ts` publishes what follows: pipeline comparison, the clear value, the sense
// of "nearer".
//
// What this file proves: the host's `[0, 1]` clip convention enters no engine number — the
// projection is the engine's own, bit for bit —; the depth of a visibility-raster vertex comes out
// in the engine's convention; and a very distant point keeps a depth distinct from its neighbour,
// where a standard-depth projection crushes them.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  createEngineCamera,
  readCameraWorld,
} from '../../../../../../packages/sdk-browser/src/camera/world.ts'
import {
  DEPTH_CLEAR,
  DEPTH_COMPARE,
  DEPTH_NEAR,
  depthNearer,
} from '../../../../../../packages/sdk-browser/src/camera/depthConvention.ts'
import { projectVisibilityVertex } from '../../../../../oracles/browser/cpu-image/projection.ts'
import { IDENTITY_WORLD } from '../../../../../../packages/sdk-browser/src/math/matrixElements.ts'
import { perspectiveProjection } from '../../../../../../packages/sdk-core/src/index.ts'

const WIDTH = 800,
  HEIGHT = 450,
  NEAR = 0.1

/** A host perspective camera of fixed pose and optics, in WebGPU's clip convention, as the
 *  engine reads it. */
function camera() {
  const cam = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, NEAR, 1000)
  cam.position.set(2, 1, 8)
  cam.lookAt(0, 0, 0)
  cam.coordinateSystem = THREE.WebGPUCoordinateSystem
  cam.updateProjectionMatrix()
  return { host: cam, engine: readCameraWorld(createEngineCamera(), cam) }
}

const { host, engine: view } = camera()

test('the host clip convention enters no engine number', () => {
  const own = perspectiveProjection(new Float64Array(16), 50, WIDTH / HEIGHT, NEAR, 1)
  for (let i = 0; i < 16; i++)
    assert.ok(
      Object.is(view.projection[i], own[i]),
      `projection[${i}]: ${view.projection[i]} instead of ${own[i]}`,
    )
  assert.notDeepEqual([...view.projection], host.projectionMatrix.elements, 'the host matrix')
})

test('engine depth is reversed: the near plane is 1, the far is 0', () => {
  assert.equal(DEPTH_COMPARE, 'greater')
  assert.equal(DEPTH_NEAR, 1)
  assert.equal(DEPTH_CLEAR, 0)
  assert.equal(depthNearer(DEPTH_NEAR, DEPTH_CLEAR), true)
  assert.equal(depthNearer(DEPTH_CLEAR, DEPTH_NEAR), false)
})

test('the depth of a projected vertex is the near plane over its eye distance', () => {
  // The origin, on the camera's optical axis: its eye distance is the camera's distance to it.
  const position = { getX: () => 0, getY: () => 0, getZ: () => 0 }
  const p = projectVisibilityVertex(IDENTITY_WORLD, position, 0, view, WIDTH, HEIGHT)
  assert.ok(p, 'the vertex must project')
  assert.ok(p!.z > 0 && p!.z < 1, `depth ${p!.z} outside the engine range`)
  const distance = Math.hypot(2, 1, 8)
  assert.ok(Math.abs(p!.z - NEAR / distance) < 1e-6 * p!.z, 'ndc = near / distance')
})

test('at 10⁶ units, two neighbouring vertices keep distinct depths in single precision', () => {
  const depthAt = (distance: number) => {
    const position = { getX: () => 0, getY: () => 0, getZ: () => 8 - distance }
    const p = projectVisibilityVertex(IDENTITY_WORLD, position, 0, view, WIDTH, HEIGHT)
    assert.ok(p, 'the distant vertex must project')
    return Math.fround(p!.z)
  }
  const close = depthAt(1e6),
    farther = depthAt(1e6 + 1)
  assert.notEqual(close, farther, `10⁶ and 10⁶+1 yield the same depth ${close}`)
  assert.equal(depthNearer(close, farther), true)
})
