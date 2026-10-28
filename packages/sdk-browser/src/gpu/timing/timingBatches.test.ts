import test from 'node:test'
import assert from 'node:assert/strict'
import { timedDevice } from './imageTimer.fixture.ts'
import { createGpuTiming } from './timing.ts'
import { VSM_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../../lighting/shadows/vsm/resources.ts'
import { encodeVsmRender } from '../../lighting/shadows/vsm/render/renderPass.ts'
import { recordingRaster } from '../../lighting/shadows/vsm/recordingRaster.fixture.ts'
import { VSM_MAX_VIEW_PASSES } from '../../lighting/shadows/vsm/render/renderViewPasses.ts'
import { keepOcclusionTables } from '../../lighting/shadows/vsm/occlusion/occlusionPass.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import type { GpuTimingSample } from './types.ts'

/** Fills, in each readback the image copied into, the timestamps its parts resolved: the one at index `k` is `(k + 1)` µs. */
const fillReadbacks = (f: ReturnType<typeof timedDevice>) => {
  for (const { to, fromOffset, toOffset, size } of f.copies) {
    const values = new BigUint64Array(to.getMappedRange(toOffset, size))
    for (let j = 0; j < values.length; j++) values[j] = BigInt(fromOffset / 8 + j + 1) * 1000n
  }
}

/** One image of `submissions` command encoders of `passes` passes each, timed, closed with its last. */
function imageOf(submissions: number, passes: number, vsmPasses = 0) {
  const f = timedDevice(),
    samples: any[] = []
  let sets = 0
  const makeSet = f.device.createQuerySet.bind(f.device)
  f.device.createQuerySet = (descriptor) => (sets++, makeSet(descriptor))
  const timer = createGpuTiming(f.device, {
    sampleEveryFrames: 1,
    onSample: (sample) => void samples.push(sample),
  })
  const image = (frame: number) => {
    f.copies.length = 0
    let last!: GPUCommandEncoder
    for (let part = 0; part < submissions; part++) {
      last = timer.createEncoder(frame)
      for (let k = 0; k < passes; k++) last.beginComputePass({ label: 'lighting' }).end()
      if (part === 0)
        for (let k = 0; k < vsmPasses; k++)
          last.beginComputePass({ label: `${VSM_PASS_PREFIX}pass` }).end()
      last.finish()
    }
    return last
  }
  return { f, timer, samples, image, sets: () => sets }
}

// Every submission of a sampled image is a part and every pass is timed, however many there are within what the timer holds: the image is timed whole.
test('ten submissions in an image make one whole sample, with the time it took', async () => {
  const { f, timer, samples, image } = imageOf(10, 3)
  const last = image(1)
  fillReadbacks(f)
  timer.submitted(last, { frame: 1 })
  await timer.flush()
  assert.equal(samples.length, 1)
  assert.equal(samples[0].passes.length, 30, 'every pass timed')
  assert.notEqual(samples[0].submittedMs, null)
  assert.notEqual(samples[0].frameMs, null)
  assert.equal(samples[0].frameMsReason, null)
  assert.equal(samples[0].submissions.length, 10, 'every submission a part')
  timer.dispose()
})

test('a frame of the most virtual shadow passes beside hundreds of others is timed whole', async () => {
  const { f, timer, samples, image } = imageOf(1, 200, 300)
  const last = image(1)
  fillReadbacks(f)
  timer.submitted(last, { frame: 1 })
  await timer.flush()
  assert.equal(samples[0].passes.length, 500)
  assert.notEqual(samples[0].submittedMs, null)
  timer.dispose()
})

test('the timer grows between images: the image that outgrew it is not timed, the ones after are whole, and nothing is made again', async () => {
  const { f, timer, samples, image, sets } = imageOf(1, 3000)
  assert.equal(sets(), 0, 'nothing made before the first image')
  const read = async (frame: number, filled: boolean) => {
    const last = image(frame)
    // The ring's buffers hold the timestamps the images resolved; the others are read as the device left them, still whole as passes.
    if (filled) fillReadbacks(f)
    timer.submitted(last, { frame })
    await timer.flush()
  }
  await read(1, false)
  assert.equal(samples.length, 0, 'the image that outgrew the timer is not timed')
  assert.equal(timer.stats().skippedFrames.overflow, 1, 'and is counted')
  // The growth is validated under error scopes, then taken by the images that follow.
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(sets(), 2, 'the first set, then the one the growth was made with')
  assert.equal(timer.stats().queryCount, 8192)
  await read(3, true)
  assert.equal(samples[0].passes.length, 3000, 'the next image is whole')
  assert.notEqual(samples[0].submittedMs, null)
  await read(5, false)
  const [setsMade, buffersMade] = [sets(), f.buffers.length]
  await read(7, false)
  await read(9, false)
  assert.equal(sets(), setsMade, 'no query set made for the images that follow')
  assert.equal(f.buffers.length, buffersMade, 'no buffer made for the images that follow')
  timer.dispose()
})

test('a growth the device refuses leaves the timer as it was: the image is not timed, nothing is taken', async () => {
  const { f, timer, samples, image, sets } = imageOf(1, 3000)
  // The error of an allocation comes back through the scope it was made under, not as a throw.
  f.device.popErrorScope = async () => ({ message: 'out of memory' }) as GPUError
  const last = image(1)
  timer.submitted(last, { frame: 1 })
  await timer.flush()
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(samples.length, 0)
  assert.equal(timer.stats().queryCount, 4096, 'the capacity it had')
  assert.ok(sets() >= 1)
  timer.dispose()
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
  for (let k = 0; k < values.length; k++) values[k] = BigInt(k + 1) * 1000n
  timer.submitted(encoder, { frame: 1 })
  await timer.flush()
  timer.dispose()
  assert.equal(samples[0].passes.length, encoded, 'every pass timed')
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
})
