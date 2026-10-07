/**
 * The session's captures are the engine's own: its GPU image read back, awaited, and its camera
 * drawn at the capture's shape, aside — the session hands the engine its camera and the size, and
 * the engine reads a box fitted to the canvas's shape (`fitAspect`) at the capture's (#1097).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Engine } from '../../engine/types.ts'
import { createEngineCamera, readCameraWorld, type HostCamera } from '../../camera/world.ts'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import { followPageCamera } from '../core/worldCamera.ts'
import { engineReads } from './sessionRuntime.ts'

test('a capture checks the session, then awaits the engine readback', async () => {
  const image = new Uint8Array(4)
  const engine = { capture: async () => image } as unknown as Engine
  let checked = 0
  const { capture } = engineReads(engine, () => checked++, hostFramingCamera(50, 1, 0.1, 100))
  assert.equal(await capture(), image)
  assert.equal(checked, 1, 'the session is checked first')
})

test('a capture is drawn aside by the engine at its size, from the session camera', async () => {
  const camera = hostFramingCamera(50, 1, 0.1, 100),
    image = new Uint8Array(64 * 16 * 4),
    asked: [HostCamera, { width: number; height: number }][] = []
  const engine = {
    captureColorView: async (at: HostCamera, size: { width: number; height: number }) => (
      asked.push([at, size]),
      image
    ),
  } as unknown as Engine
  let checked = 0
  const { captureView } = engineReads(engine, () => checked++, camera)
  assert.equal(await captureView(64, 16), image)
  assert.deepEqual(asked, [[camera, { width: 64, height: 16 }]])
  assert.equal(checked, 1, 'the session is checked first')
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
