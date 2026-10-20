import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { createSelectionUniforms } from '../../gpu/core/selection.ts'
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts'
import { cullStep, freezeWebgpuCut } from '../../webgpu/pages/render/cutFreeze.ts'
import { cameraAt } from './inspection.fixture.ts'
import { inspectFrame } from './read.ts'
import { decodeReflections, sampleGrid } from './reflections.ts'
import { INSPECTION_REFLECTION_CAP } from './types.ts'

test('the reflection samples: one texel in stride² of the grid, never past the cap', () => {
  assert.deepEqual(sampleGrid(64, 32), { stride: 1, columns: 64, count: 2048 })
  const big = sampleGrid(960, 540)
  assert.ok(big.count <= INSPECTION_REFLECTION_CAP && big.stride === 6)
  // 255 × 257 texels fit the cap at stride 2, their rounded-up 128 × 129 samples do not.
  const rounded = sampleGrid(255, 257)
  assert.equal(rounded.stride, 3)
  assert.ok(rounded.count <= INSPECTION_REFLECTION_CAP)
})

/** A valid sample of texel (`x`, `y`) at `depth`, its ray `dir` going `distance`. */
const sample = (x: number, y: number, depth: number, dir: number[], distance: number) => [
  ...dir,
  distance,
  x,
  y,
  depth,
  1,
]

test('the reflection rays placed in the world: back toward the eye, out of the view, missed', () => {
  const cam = cameraAt([0, 0, 0])
  // A 64 × 64 target: grid texel (15.5, 15.5) is its centre, the eye's axis.
  const samples = Float32Array.from([
    ...sample(15.5, 15.5, 10, [0, 0, 1], 3),
    ...sample(15.5, 15.5, 10, [1, 0, 0], 1000),
    ...sample(15.5, 15.5, 10, [0, 1, 0], HALF_MAX),
    ...[0, 0, 0, 0, 0, 0, 0, 0],
  ])
  const rays = decodeReflections(samples, 4, 2, cam, [64, 64])
  assert.equal(rays.count, 3)
  assert.equal(rays.stride, 2)
  // Each leaves the surface 10 m ahead on the axis.
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(rays.origins[3 * i]) < 1e-5 && Math.abs(rays.origins[3 * i + 1]) < 1e-5)
    assert.ok(Math.abs(rays.origins[3 * i + 2] + 10) < 1e-4)
  }
  assert.equal(rays.distances[0], 3)
  assert.equal(rays.distances[2], Infinity)
  assert.equal(rays.towardCamera, 1)
  // 1000 m sideways leaves a 90° view; the ray back toward the eye stays in it.
  assert.equal(rays.offView, 1)
  assert.equal(rays.missed, 1)
})

/** A runtime as an inspection request and the freeze read it. */
function runtime() {
  const closer = new AbortController()
  let changed = 0
  const views = { main: {}, active: {} }
  views.active = views.main
  const cam = cameraAt([0, 0, 0])
  const rt = {
    signal: closer.signal,
    gpu: { device: {} },
    views,
    run: {
      lost: false,
      lastCamera: {},
      selectionUniforms: createSelectionUniforms(),
      gate: { cam, resourcesChanged: () => changed++ },
    },
  } as unknown as WebgpuPagesRuntime
  return { rt, closer, changed: () => changed }
}

test('one inspection request serves every caller, asks an image, and a closed session answers null', async () => {
  const { rt, closer, changed } = runtime()
  const first = inspectFrame(rt)
  assert.equal(inspectFrame(rt), first)
  assert.equal(changed(), 1)
  assert.equal(typeof rt.run.inspect, 'function')
  closer.abort()
  assert.equal(await first, null)
  assert.equal(await inspectFrame(rt), null)
})

test('a frozen cut holds its camera: held in the main view, aside elsewhere, until it follows', () => {
  const { rt, changed } = runtime()
  assert.equal(cullStep(rt), 'follow')
  freezeWebgpuCut(rt, true)
  assert.equal(cullStep(rt), 'held')
  assert.notEqual(rt.run.cullView!.camera, rt.run.gate.cam)
  assert.deepEqual(rt.run.cullView!.camera.eye, rt.run.gate.cam.eye)
  assert.equal(rt.run.selectionUniforms.ahead, null)
  // Frozen twice: nothing more asked.
  freezeWebgpuCut(rt, true)
  assert.equal(changed(), 1)
  rt.views.active = {} as never
  assert.equal(cullStep(rt), 'aside')
  rt.views.active = rt.views.main
  freezeWebgpuCut(rt, false)
  assert.equal(cullStep(rt), 'follow')
  assert.equal(changed(), 2)
})
