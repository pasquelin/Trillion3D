import test from 'node:test'
import assert from 'node:assert/strict'
import { metricsOf, vertexBytesOf } from './metrics.ts'
import { createWebgpuRunState } from '../backend/state/runState.ts'
import { createWebgpuVisState } from '../backend/state/vis.ts'
import { createWebgpuBlendState } from '../../blend/state.ts'
import { createWebgpuLightState } from '../backend/state/lights.ts'
import { createWebgpuBounceState } from '../backend/state/bounce.ts'
import { createWebgpuTimingState } from '../backend/state/timing.ts'
import { createScaleControl } from '../scale/scaleControl.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The smallest runtime `metricsOf` reads: fresh states around `run` and `gpu`, nothing
 *  streamed yet. */
function runtimeOver(run: ReturnType<typeof createWebgpuRunState>, gpu: object = {}) {
  return {
    run,
    // A view's state holds the size it draws at from its creation (`createWebgpuGpuState`).
    gpu: { targetSize: [1, 1], ...gpu },
    vis: createWebgpuVisState(),
    timing: createWebgpuTimingState(),
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true }, residencySets: { keepCount: 0 } },
    setup: { geometryPool: { slots: 0 }, texturePool: {} },
    lights: createWebgpuLightState(),
    bounce: createWebgpuBounceState(false),
    views: { main: { scale: createScaleControl(undefined) } },
  } as unknown as WebgpuPagesRuntime
}

// The triangles drawn are the cut's selected, its drawn list taken after both its occlusion
// passes, without the `pending` guard (`!gpuMetricsReady`) that hides `submittedTriangles`.
test('metricsOf publishes drawnTriangles as the cut selected them', () => {
  const run = createWebgpuRunState()
  run.gpuMetricsReady = false // An image still in flight: submittedTriangles must be null.
  run.selectedTriangles = 4321
  const metrics = metricsOf(runtimeOver(run))
  assert.equal(metrics.selectedTriangles, 4321)
  assert.equal(metrics.drawnTriangles, 4321)
  assert.equal(metrics.submittedTriangles, null, 'witness: the pending guard does hide this one')
})

test("texture metrics are the streamer's, and `null` until it is built", () => {
  const rt = runtimeOver(createWebgpuRunState())
  const before = metricsOf(rt) as Record<string, unknown>
  assert.equal('texturePoolBytes' in before, false, 'no pool: nothing is published, not even zero')
  rt.vis.textures = {
    metrics: () => ({ texturePoolBytes: 512, textureTilesResident: 3, textureLevelReads: null }),
  } as unknown as typeof rt.vis.textures
  const metrics = metricsOf(rt)
  assert.equal(metrics.texturePoolBytes, 512)
  assert.equal(metrics.textureTilesResident, 3)
  assert.equal(metrics.textureLevelReads, null, 'without a level reader: unmeasured, never zero')
})

// The geometry bytes beside the page pool are the float pool's three lists, read where they lie:
// nothing else holds vertices (a transparent draws its clusters from the page cache).
test("vertexBytesOf sums the float pool's positions, UVs and normal atlas, a missing one as zero", () => {
  const buffer = (size: number) => ({ size }) as unknown as GPUBuffer
  const bytes = (vis: object) => vertexBytesOf(vis as Parameters<typeof vertexBytesOf>[0])
  assert.equal(bytes({}), 0)
  const pool = { concatPos: buffer(2048), concatUv: buffer(512), vertexPool: { normalBytes: 96 } }
  assert.equal(bytes(pool), 2048 + 512 + 96)
  assert.equal(bytes({ concatUv: buffer(64) }), 64)
})

// The effect chain's targets count in the frame target bytes, like the frame's own.
test('the targets of the effect chain count in gpuFrameTargetBytes', () => {
  const gpu = { targetBytes: 1000, effects: { bytes: 24 } }
  assert.equal(metricsOf(runtimeOver(createWebgpuRunState(), gpu)).gpuFrameTargetBytes, 1024)
  const bare = { targetBytes: 1000 }
  assert.equal(metricsOf(runtimeOver(createWebgpuRunState(), bare)).gpuFrameTargetBytes, 1000)
})

test('the display cadence and the GPU idle are published as the scale clock and the timer hold them', () => {
  const rt = runtimeOver(createWebgpuRunState())
  const before = metricsOf(rt)
  assert.equal(before.rafIntervalMs, null, 'no frame interval before two frames')
  assert.equal(before.displayRefreshMs, null, 'no refresh before the clock finds one')
  for (let frame = 0; frame < 4; frame++) rt.views.main.scale.tick((frame * 1000) / 120)
  // A frame that missed a refresh: two of them, read on the same grid.
  rt.views.main.scale.tick((5 * 1000) / 120)
  rt.timing.lastGpuIdleMs = 1.25
  const metrics = metricsOf(rt)
  assert.ok(Math.abs(metrics.rafIntervalMs! - 2000 / 120) < 1e-9)
  assert.ok(Math.abs(metrics.displayRefreshMs! - 1000 / 120) < 1e-9)
  assert.equal(metrics.gpuIdleMs, 1.25)
})

test('the size the image was drawn at is the one every pass up to the resolve drew at', () => {
  const gpu = { targetSize: [1728, 1112] }
  const metrics = metricsOf(runtimeOver(createWebgpuRunState(), gpu))
  assert.deepEqual([metrics.renderWidth, metrics.renderHeight], [1728, 1112])
})
