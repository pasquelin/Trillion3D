import test from 'node:test'
import assert from 'node:assert/strict'
import { timedDevice } from './imageTimer.fixture.ts'
import { createGpuTiming } from './timing.ts'
import { QUERY_COUNT, TIMED_PASSES } from './queries.ts'
import { VSM_TIMED_PASSES } from './vsmPasses.ts'
import { VSM_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../../lighting/shadows/vsm/resources.ts'
import { encodeVsmRender } from '../../lighting/shadows/vsm/render/renderPass.ts'
import { recordingRaster } from '../../lighting/shadows/vsm/recordingRaster.fixture.ts'
import { VSM_MAX_VIEW_PASSES } from '../../lighting/shadows/vsm/render/renderViewPasses.ts'
import { keepOcclusionTables } from '../../lighting/shadows/vsm/occlusion/occlusionPass.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import type { GpuTimingSample } from './types.ts'

// The virtual shadow maps' frame: its passes (`vsmPasses.ts`). The frame of the most view passes it
// is timed over is timed whole, so its shadow milliseconds are published; one past the
// image's passes is truncated.
const frameOf = async (vsmPasses: number) => {
  const f = timedDevice(),
    samples: any[] = []
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) })
  const selection = timer.createEncoder(1)
  selection.beginComputePass({ label: 'selection' }).end()
  selection.finish()
  const frame = timer.createEncoder(1)
  const pass = (label: string) => frame.beginComputePass({ label }).end()
  for (let k = 0; k < vsmPasses; k++) pass(`${VSM_PASS_PREFIX}pass`)
  for (let k = 0; k < 200; k++) pass('lighting')
  frame.finish()
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  for (let k = 0; k < QUERY_COUNT; k++) values[k] = BigInt(k + 1) * 1000n
  timer.submitted(frame, { frame: 1 })
  await timer.flush()
  timer.dispose()
  return samples[0]
}

test('a frame of the most virtual shadow passes is timed whole', async () => {
  const sample = await frameOf(VSM_TIMED_PASSES)
  assert.equal(sample.truncated, false, 'every pass timed')
  assert.equal(sample.passes.length, 1 + VSM_TIMED_PASSES + 200)
  assert.ok(sample.passes.length <= TIMED_PASSES)
})

test('a frame past the passes an image is timed over is flagged truncated', async () => {
  const sample = await frameOf(TIMED_PASSES)
  assert.equal(sample.truncated, true)
})

test('the raster at the most view passes is timed whole, as the passes are sized for', async () => {
  // 65 537 maps in lights of 65 536 and 1, past the 65 535 rows of a dispatch: the most view
  // passes, 2. The raster encodes a compute and a raster pass a view pass, whatever the rows (the
  // chunks of rows that once multiplied them are gone).
  const f = fakeDevice({
    features: ['timestamp-query'],
    limits: { maxStorageBufferBindingSize: 1 << 20, maxBufferSize: 1 << 20 },
  })
  const samples: GpuTimingSample[] = []
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) })
  const encoder = timer.createEncoder(1)
  const res = createVsmResources(f.device, {
    coverMode: 'suns',
    fullMapCapacity: 63,
    poolPages: 256,
  })
  const { scene } = recordingRaster(f.device, 65_536)
  // Every map id a frame holds: the id is 16 bits wide in the words the cull packs.
  const lights = [
    { kind: 'point' as const, firstId: 0, count: 1 << 16 },
    { kind: 'point' as const, firstId: 1 << 16, count: 1 },
  ]
  const stats = encodeVsmRender(encoder, res, { device: f.device, lights }, scene)!
  encoder.finish()
  const encoded = f.computePasses.length + f.passes.length
  assert.deepEqual([stats.passes, encoded], [VSM_MAX_VIEW_PASSES, 2 * VSM_MAX_VIEW_PASSES])
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  for (let k = 0; k < QUERY_COUNT; k++) values[k] = BigInt(k + 1) * 1000n
  timer.submitted(encoder, { frame: 1 })
  await timer.flush()
  timer.dispose()
  assert.equal(samples[0].truncated, false, 'every pass timed')
  assert.equal(samples[0].passes.length, encoded)
})

// With the occlusion culling and the previous frame's pyramid and tables kept, a view pass draws what
// its first cull keeps, builds the pyramid over it, judges again the nodes its descent held back,
// culls again what the first held back and what they hold, and draws that; the frame's last build follows every view pass
// (`vsmEncode.ts`). Each view pass is then five passes (seven with the software raster's, one after each raster) on a frame timed per pass, which the
// timer is sized for, and four otherwise (the build and the second cull follow one another: one pass); without a previous frame, the cull with no test and its raster alone.
test('the occlusion’s two culls a view pass: cull, raster, pyramid, second cull, second raster', async () => {
  const f = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 20, maxBufferSize: 1 << 20 } })
  const res = createVsmResources(f.device, {
    coverMode: 'suns',
    fullMapCapacity: 63,
    poolPages: 256,
  })
  const raster = recordingRaster(f.device, 1000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
  const frame = (kept: boolean) => {
    f.commands.length = 0
    f.dispatches.length = 0
    res.occlusion!.prevKept = kept
    keepOcclusionTables(raster.encoder, res, { mapCount: 17, blocks: 17 })
    encodeVsmRender(raster.encoder, res, { device: f.device, lights }, raster.scene)
    return {
      commands: f.commands.filter((c) => c !== 'clear'),
      entries: f.dispatches.map((d) => d.entryPoint),
    }
  }
  // Frames of each kind ask the programs they skip, each one's the next stage's, till all are made.
  for (let asked = true; asked;) {
    frame(false)
    frame(true)
    const settled = pipelinesSettled(f.device)
    asked = !!settled
    await settled
  }
  const first = frame(false)
  // The kept tables' three copies, the frame's lights copied into the descent's work and the shadow views'
  // requests of the frame before read back (the requests' copy came with the shadow views' descent,
  // `traversal/`) open the frame: the casters' list has a fixed room, its count read back by none.
  assert.deepEqual(first.commands, [
    'copy',
    'copy',
    'copy',
    'copy',
    'copy',
    `compute ${VSM_PASS_PREFIX}render.cull 0`,
    `render ${VSM_PASS_PREFIX}render.raster 0`,
  ])
  assert.ok(
    first.entries.includes('vsmRenderCull') && !first.entries.includes('vsmRenderCullFirst'),
  )
  const { commands, entries } = frame(true)
  assert.deepEqual(commands.slice(5), [
    `compute ${VSM_PASS_PREFIX}render.cull 0`,
    `render ${VSM_PASS_PREFIX}render.raster 0`,
    'copy',
    `compute ${VSM_PASS_PREFIX}occlusion.build`,
    `render ${VSM_PASS_PREFIX}render.rasterSecond 0`,
  ])
  const after = (name: string) => entries.slice(entries.indexOf(name))
  assert.deepEqual(after('vsmRenderCullFirst').slice(0, 3), [
    'vsmRenderCullFirst',
    'vsmRenderArgsBin',
    'vsmRenderBin',
  ])
  assert.deepEqual(after('vsmSelectPyramidPages'), [
    ...['vsmSelectPyramidPages', 'vsmBuildPyramid', 'vsmBuildPyramidTop'],
    // The descent's post pass over the nodes held back, the casters of what it lists, then the culls.
    ...['dagPostPrepare', 'dagArm', 'dagPostNodes', 'dagArm', 'dagLevel0', 'dagArm', 'dagLevel1'],
    ...['dagArm', 'vsmDescentClose', 'vsmRenderCandidates', 'vsmRenderCandidatesPostDone'],
    ...['vsmRenderArgsSecond', 'vsmRenderCullPost', 'vsmRenderCullSecond'],
    ...['vsmRenderArgsBin', 'vsmRenderBin'],
  ])
  // The view passes' passes and the last build fit what the timer reads.
  assert.ok(7 * VSM_MAX_VIEW_PASSES + 1 <= VSM_TIMED_PASSES)
})
