/**
 * A capture draws the session's camera at the capture's shape: an orthographic camera keeps its
 * box's matrix through the draw and after it, whatever aspect the capture writes, and a box
 * fitted to the canvas's shape (`fitAspect`) is fitted to the capture's (#1097).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { RenderBackend } from '../../backend/types.ts'
import { createEngineCamera, readCameraWorld, type HostCamera } from '../../camera/world.ts'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import { createTestContext } from '../../webgl/core/testContext.fixture.ts'
import { followPageCamera } from '../core/worldCamera.ts'
import { createExplorerCaptureView } from './view.ts'

/** The session following `page` on a 2:1 canvas, and its capture, which hands `render` what it
 *  draws. */
function captureOf(page: Camera, render: (camera: HostCamera) => void) {
  const session = hostFramingCamera(50, 1, 0.1, 100)
  followPageCamera(() => page, { width: 800, height: 400 } as HTMLCanvasElement)(session)
  const capture = createExplorerCaptureView({
    camera: session,
    context: createTestContext().gl,
    active: () => ({ render }) as unknown as RenderBackend,
    check: () => {},
    compose: (() => {}) as never,
  })
  return { session, capture, box: Array.from(session.projectionMatrix.elements) }
}

test('an orthographic capture draws and gives back the box matrix, not a perspective one', async () => {
  const page = new Camera('orthographic', { left: -4, right: 4, top: 2, bottom: -2, far: 50 })
  const drawn: number[][] = []
  const { session, capture, box } = captureOf(page, (camera) =>
    drawn.push(Array.from(camera.projectionMatrix.elements)),
  )
  await capture(64, 16)
  assert.deepEqual(drawn, [box], 'the capture draws the box')
  assert.deepEqual(Array.from(session.projectionMatrix.elements), box, 'and gives it back')
})

test('a box fitted to the canvas (`fitAspect`) is fitted to the capture, then given back', async () => {
  const page = new Camera('orthographic', { top: 2, bottom: -2, far: 50, fitAspect: true })
  const drawn: number[][] = []
  const { session, capture, box } = captureOf(page, (camera) =>
    drawn.push([
      camera.projectionMatrix.elements[0],
      readCameraWorld(createEngineCamera(), camera).projection[0],
    ]),
  )
  await capture(64, 64)
  // Four units high at a square shape: four wide, where the 2:1 canvas drew eight.
  assert.equal(box[0], 1 / 4)
  assert.deepEqual(drawn, [[1 / 2, 1 / 2]], 'host matrix and engine projection at the capture')
  assert.deepEqual(Array.from(session.projectionMatrix.elements), box, 'and the box given back')
})

test('an engine drawing a capture aside reads a fitted box at the capture shape, any other as declared', () => {
  const follow = (fitAspect: boolean, width: number) => {
    const session = hostFramingCamera(50, 1, 0.1, 100)
    const page = new Camera('orthographic', { top: 2, bottom: -2, far: 50, fitAspect })
    followPageCamera(() => page, { width, height: 400 } as HTMLCanvasElement)(session)
    return session
  }
  const projection = (camera: HostCamera, aspect?: number) =>
    Array.from(readCameraWorld(createEngineCamera(), camera, aspect).projection)
  // Drawn at 1:1 from a 2:1 canvas, the fitted box is the one a square canvas fits.
  assert.deepEqual(projection(follow(true, 800), 1), projection(follow(true, 400)))
  // The canvas's own shape draws the box it holds, and a declared box never moves.
  assert.deepEqual(projection(follow(true, 800), 2), projection(follow(true, 800)))
  assert.deepEqual(projection(follow(false, 800), 1), projection(follow(false, 800)))
})
