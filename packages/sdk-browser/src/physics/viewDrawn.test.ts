// The view the simulation is sent (`view.ts`): an orthographic camera's is the engine's drawn one,
// whose planes moved its origin and its far plane (`camera/world.ts`); a perspective camera's, and the
// camera's before an image was drawn, are the camera's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CommandWriter } from '../../../sdk-core/src/physics/commands.ts'
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { createPhysicsView, viewWorld } from './view.ts'

/** The VIEW command a writer was last given: eye, facing, half cone, range. */
function writer() {
  const sent = { eye: [0, 0, 0], facing: [0, 0, 0], halfCone: NaN, range: NaN }
  const view = {
    view(eye: ArrayLike<number>, facing: ArrayLike<number>, halfCone: number, range: number) {
      // A negative zero is the zero it is.
      const plain = (v: ArrayLike<number>) => Array.from(v, (value) => value + 0)
      Object.assign(sent, { eye: plain(eye), facing: plain(facing), halfCone, range })
    },
  } as unknown as CommandWriter
  return { sent, view }
}

/** A camera at (0, 50, 0) looking down, as the page declares it: far 100. */
const pageCamera = (projection: 'orthographic' | 'perspective') => {
  const elements = new Float64Array(16)
  elements.set([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 50, 0, 1])
  return {
    updateWorldMatrix() {},
    matrixWorld: { elements },
    projection,
    fov: 60,
    aspect: 1,
    far: 100,
  } as unknown as Camera
}

/** The engine's camera for it: its origin moved onto the near plane, its far plane worked out. */
const drawn = {
  world: Float64Array.from([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 49.5, 0, 1]),
  far: 658.5,
} as unknown as EngineCamera

test('an orthographic view is sent from the drawn camera’s origin, to its far plane', () => {
  const { sent, view } = writer()
  const reach = createPhysicsView()(pageCamera('orthographic'), view, null, drawn)
  assert.deepEqual(sent.eye, [0, 49.5, 0])
  assert.deepEqual(sent.facing, [0, -1, 0])
  assert.equal(sent.range, 658.5)
  assert.equal(reach, 658.5)
  // The range of the world’s physics, when it names one, stands.
  const named = writer()
  assert.equal(createPhysicsView()(pageCamera('orthographic'), named.view, 30, drawn), 30)
})

test('a perspective view, and any view before an image was drawn, are the camera’s own', () => {
  const perspective = writer()
  createPhysicsView()(pageCamera('perspective'), perspective.view, null, drawn)
  assert.deepEqual(perspective.sent.eye, [0, 50, 0])
  assert.equal(perspective.sent.range, 100)
  const before = writer()
  createPhysicsView()(pageCamera('orthographic'), before.view, null, null)
  assert.deepEqual(before.sent.eye, [0, 50, 0])
  assert.equal(before.sent.range, 100)
  assert.equal(viewWorld(pageCamera('orthographic'), null)[13], 50)
  assert.equal(viewWorld(pageCamera('orthographic'), drawn)[13], 49.5)
})
