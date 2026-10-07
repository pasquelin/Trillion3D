import assert from 'node:assert/strict'
import test from 'node:test'
import * as G from '../../host/graph/graph.fixture.ts'
import { createExplorerViewportApi } from './viewportApi.ts'
import type { MeasuredWorldOptions, Engine } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'

test('public resize sizes the page canvas the engine presents into', () => {
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement
  const viewport: [number, number] = [0, 0]
  let blanked = 0
  const api = createExplorerViewportApi({
    check: () => {},
    engine: { canvasResized: () => blanked++ } as never,
    setCapturingSurface: () => {},
    camera: { aspect: 0, updateProjectionMatrix: () => {} } as never,
    canvas,
    viewport,
    options: { manifestUrl: '', pixelRatio: 1.5 },
  })
  api.resize(20, 10)
  assert.deepEqual(viewport, [30, 15])
  assert.equal(blanked, 1, 'the engine presents into a canvas sizing blanked')
})

// THE CAPTURE VIEW IS AIMED AT A REAL HOST POINT.
//
// `captureSurfaceView` clones the live camera and aims it at the pose's target. A host's vector
// class tells its own vector from a triple of numbers by a flag of its own: handed a plain
// `{ x, y, z }` literal it reads the object as the first number and the other two as
// `undefined`, and the world matrix comes out `[NaN, NaN, NaN, 0]`. The existing capture tests
// call the backend directly and never go through this boundary, so the view is checked here,
// where it is built: its sixteen floats are finite and it looks at the target it was given.
test('captureSurfaceView hands the backend a finite view aimed at the pose target', async () => {
  const camera = G.perspectiveCamera(50, 1.5, 0.1, 100)
  camera.position.set(1, 2, 3)
  camera.updateMatrixWorld()
  let view: HostCamera | undefined
  const backend = { id: 'webgpu-page-raster' } as Engine
  // What a real backend gives back needs a device; the view it was handed does not, so the
  // capture records it and stops there, and the boundary lowers its flag in its `finally`.
  backend.captureSurfaceView = async (given) => {
    view = given
    throw new Error('CAPTURE_STOPPED')
  }
  const api = createExplorerViewportApi({
    check: () => {},
    engine: backend,
    setCapturingSurface: () => {},
    camera,
    canvas: { width: 8, height: 8 } as HTMLCanvasElement,
    viewport: [8, 8],
    options: {} as MeasuredWorldOptions,
  })
  await assert.rejects(
    api.captureSurfaceView(
      { position: [4, 0, 0], target: [0, 0, 0], fov: 60, near: 0.5, far: 200 },
      { width: 4, height: 2 },
    ),
    /CAPTURE_STOPPED/,
  )
  assert.ok(view, 'the backend must have received a view')
  const elements = Array.from(view.matrixWorld.elements)
  assert.equal(elements.length, 16)
  assert.ok(
    elements.every((value) => Number.isFinite(value)),
    `the capture view must have a finite world matrix, got ${elements.join(', ')}`,
  )
  // Aimed at the origin from `+x`: a camera looks down its own `-z`, so the third column — the
  // axis pointing BACK from the target — is `+x`, and the fourth column is the eye.
  assert.ok(Math.abs(elements[8] - 1) < 1e-12, `looks at the target, got ${elements[8]}`)
  assert.deepEqual([elements[12], elements[13], elements[14]], [4, 0, 0])
})
