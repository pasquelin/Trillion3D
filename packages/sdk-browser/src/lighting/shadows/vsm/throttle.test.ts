// The compute throttle's budgets and the frame it keeps between frames: the most it adds, the bias
// the upload does not let add up, the valid bit of the next-map records and the two frames' turns.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { markWrittenOnGpu } from '../../../gpu/core/writeChanged.ts'
import { VsmCacheManager } from './cacheManager.ts'
import {
  VSM_NEXT_ID_VALID,
  VSM_NEXT_KEEPS_PAGES,
  VSM_PROJECTION_RECORD_BYTES,
} from './constants.ts'
import { uploadProjectionData } from './frameUploads.ts'
import { createVsmFrameState } from './frameState.ts'
import { VsmMapIds } from './mapIds.ts'
import { VSM_PROJECTION_LEVEL_BIAS_WORD } from './projection/projectionData.ts'
import { createVsmResources, vsmFrameParity, vsmFrameSetHeld } from './resources.ts'
import {
  encodeVsmThrottle,
  keepVsmThrottle,
  vsmThrottled,
  vsmThrottleState,
  type VsmThrottleState,
} from './throttle.ts'
import { VSM_THROTTLE_PARAMS, vsmThrottleWords } from './throttleWgsl.ts'
import { vsmFeedbackWords } from './render/renderParamsWgsl.ts'
import { settings } from './throttle.fixture.ts'

/** The most levels the throttle's kernels are told they may add to a sun's maps and to a local light's,
 *  for `shadows` and a pool bias of `pool`: read from the parameters `encodeVsmThrottle` writes. */
function writtenBiases(shadows: ReturnType<typeof settings>, pool: number) {
  const fake = fakeDevice()
  const res = createVsmResources(fake.device, {
    coverMode: 'suns',
    fullMapCapacity: 7,
    poolPages: 256,
  })
  const bytes = 4 * VSM_THROTTLE_PARAMS.words
  const params = fake.device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const data = new ArrayBuffer(bytes)
  // The kernels' pipelines, groups and the buffers they name are not read here: stand-ins.
  const buffer = {} as GPUBuffer,
    pipeline = { getBindGroupLayout: () => ({}) } as unknown as GPUComputePipeline
  const held: VsmThrottleState = {
    device: { createBindGroup: () => ({}) } as unknown as GPUDevice,
    ...{ mapSlots: 8, feedbackWords: 0, feedback: [buffer, buffer], throttle: [buffer, buffer] },
    ...{ params, paramU32: new Uint32Array(data), paramF32: new Float32Array(data) },
    ...{ maxBiases: [0, 0], pipelines: { process: pipeline, update: pipeline } },
    ...{ prevKept: true, active: true },
    groups: { process: vsmFrameSetHeld(), update: vsmFrameSetHeld() },
  }
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups() {},
  } as unknown as GPUComputePassEncoder
  const vsm = { res, state: { maps: { shadows }, cache: { pressureBias: pool } } }
  const plan = { nextMapCount: 1, projectionCount: 1 }
  encodeVsmThrottle(pass, { device: fake.device, vsm, plan, throttle: held, strength: -1 } as never)
  const image = new ArrayBuffer(bytes)
  replayWrites(
    image,
    fake.writes.filter((w) => w.buffer === params),
  )
  const f = new Float32Array(image),
    at = VSM_THROTTLE_PARAMS.at
  return [f[at.maxBiasDirectional], f[at.maxBiasLocal]]
}

test('a budget above 0 asks the throttle; the most it adds is the lower limit less the pool’s bias', () => {
  assert.equal(vsmThrottled(settings()), false)
  assert.equal(vsmThrottled(settings({ shadowDynamicResolutionLoadBudget: 1 })), true)
  assert.equal(vsmThrottled(settings({ shadowDynamicResolutionTimeBudgetMs: 4 })), true)
  const s = settings({
    shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional: 0.5,
    shadowDynamicResolutionMaxComputeResolutionLodBiasLocal: 1.5,
  })
  assert.deepEqual(writtenBiases(s, 0), [0.5, 1.5], 'the caps under the limit of 2')
  // The directional cap 0.5 is under what the pool left of the limit (1): it takes it all.
  assert.deepEqual(writtenBiases(s, 1), [0, 0.5], 'the pool took 1 of the limit of 2')
  assert.deepEqual(writtenBiases(s, 3), [0, 0], 'the pool took it all')
  assert.deepEqual(writtenBiases(settings(), 0.5), [1.5, 1.5], 'the limit, no cap of their own')
})

// ---- The upload keeps the bias from adding up ---------------------------------------------------

/** A set of a sun's two maps at ids 0 and 1 on a recording device, and the GPU's copy of each of the
 *  projection data buffers the frames take turns in. */
function uploads() {
  const fake = fakeDevice()
  const res = createVsmResources(fake.device, {
    coverMode: 'suns',
    fullMapCapacity: 7,
    poolPages: 256,
  })
  const state = createVsmFrameState(fake.device, res)
  const entry = state.cache.lightEntryFor('sun', 2)
  entry.moveToMapId(0)
  for (const map of entry.mapCaches) map.projectionData.levelBias = 1.25
  const ids = new VsmMapIds().reset()
  const gpu = new Map<GPUBuffer, ArrayBuffer>()
  const bias = (id: number) =>
    (id * VSM_PROJECTION_RECORD_BYTES) / 4 + VSM_PROJECTION_LEVEL_BIAS_WORD
  /** One frame over `maps` maps: the upload, what the buffer then holds, then the throttle's kernel
   *  adding `extra` to the maps' bias (marking the buffer), and the frame set swapped. */
  let sent = 0
  const frame = (maps: number, extra: number) => {
    ids.mapCount = maps
    const buffer = res.current.projectionData
    uploadProjectionData(state, ids)
    const image = gpu.get(buffer) ?? new ArrayBuffer(buffer.size)
    gpu.set(buffer, image)
    const mine = fake.writes.filter((w) => w.buffer === buffer)
    sent = mine.length
    replayWrites(image, mine)
    fake.writes.length = 0
    const f = new Float32Array(image)
    const read = [f[bias(0)], f[bias(1)]]
    if (extra) {
      for (let id = 0; id < maps; id++) f[bias(id)] += extra
      markWrittenOnGpu(buffer, (maps * VSM_PROJECTION_RECORD_BYTES) / 4)
    }
    res.swapFrames()
    return read
  }
  return { frame, res, sent: () => sent }
}

test('the projection data the throttle edited goes up whole once, whatever the frames between', () => {
  const { frame, res } = uploads()
  assert.equal(vsmFrameParity(res), 0)
  const clean = [1.25, 1.25]
  // Frames that add 0.5 on the GPU: each upload puts the setup's bias back before the kernel adds.
  frame(2, 0.5)
  for (let k = 0; k < 4; k++) assert.deepEqual(frame(2, 0.5), clean, `throttled frame ${k}`)
  assert.equal(vsmFrameParity(res), 1, 'the pair took turns')
  // A frame of no map, then the maps back: the buffers it left biased are sent whole before use.
  frame(0, 0)
  assert.deepEqual(frame(2, 0), clean, 'the first frame after the empty one')
  assert.deepEqual(frame(2, 0), clean, 'the second, on the other buffer')
})

test('off, the projection data goes up by what changed alone: a still view sends nothing', () => {
  const { frame, sent } = uploads()
  // Each of the pair's buffers is sent its records once.
  for (let k = 0; k < 2; k++) {
    frame(2, 0)
    assert.ok(sent() > 0, `buffer ${k} is sent its records`)
  }
  for (let k = 0; k < 4; k++) {
    frame(2, 0)
    assert.equal(sent(), 0, `frame ${k}`)
  }
})

test('a previous id that has a next one carries the valid bit, with the pages’ bit when they are kept', () => {
  const cache = new VsmCacheManager()
  const entry = cache.lightEntryFor('spot', 1)
  const flagsOfPrevious = () => {
    // The light held id 3 and is given another: its next-map data lies under 3.
    entry.moveToMapId(3)
    const ids = new VsmMapIds().reset()
    ids.claim(entry, 'light')
    ids.seal()
    cache.commitIds(ids)
    return ids.nextMaps[3].flags
  }
  entry.mapCaches[0].update(entry)
  assert.equal(flagsOfPrevious(), VSM_NEXT_ID_VALID, 'never rendered: no pages kept')
  entry.markRendered(1)
  entry.mapCaches[0].update(entry)
  assert.equal(flagsOfPrevious(), VSM_NEXT_ID_VALID | VSM_NEXT_KEEPS_PAGES)
})

test('the frame that ran the throttle and kept its maps is the next frame’s previous one', () => {
  const res = { throttle: { prevKept: false, active: true } }
  keepVsmThrottle(res, true)
  assert.deepEqual([res.throttle.prevKept, res.throttle.active], [true, false])
  keepVsmThrottle(res, true)
  assert.equal(res.throttle.prevKept, false, 'a frame that ran none: none kept')
  res.throttle.active = true
  keepVsmThrottle(res, false)
  assert.equal(res.throttle.prevKept, false, 'a frame that kept no maps')
})

const throttleMade = (fake: ReturnType<typeof fakeDevice>, mapSlots: number) => {
  const buffer = (words: number) =>
    fake.device.createBuffer({
      size: 4 * words,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
  const [feedbackWords, throttleWords] = [vsmFeedbackWords(mapSlots), vsmThrottleWords(mapSlots)]
  return {
    device: fake.device,
    mapSlots,
    feedback: [buffer(feedbackWords), buffer(feedbackWords)],
    throttle: [buffer(throttleWords), buffer(throttleWords)],
    params: buffer(VSM_THROTTLE_PARAMS.words),
    prevKept: false,
  } as unknown as VsmThrottleState
}

test('the slots of the throttle growing, the previous frame’s feedback and throttle buffer are copied whole into the new ones', () => {
  const fake = fakeDevice()
  const res = createVsmResources(fake.device, {
    coverMode: 'suns',
    fullMapCapacity: 7,
    poolPages: 256,
  })
  const previous = 1 - vsmFrameParity(res)
  // The set holds the throttle of fewer slots than its layout asks.
  const old = throttleMade(fake, 8)
  old.prevKept = true
  res.throttle = old
  fake.copies.length = 0
  const grown = vsmThrottleState(fake.device, res)
  assert.notEqual(grown, old, 'made again')
  // Only the previous frame's pair goes, a map slot's words at the same place in the new ones.
  const wanted = (key: 'feedback' | 'throttle') => ({
    from: old[key][previous],
    to: grown[key][previous],
    fromOffset: 0,
    toOffset: 0,
    size: old[key][previous].size,
  })
  assert.deepEqual(fake.copies, [wanted('feedback'), wanted('throttle')])
  assert.equal(grown.prevKept, true, 'the previous frame is still the next one’s previous')
})

test('a smaller set of slots carries nothing and the history restarts: a partial copy would be read past its end', () => {
  const fake = fakeDevice()
  const res = createVsmResources(fake.device, {
    coverMode: 'suns',
    fullMapCapacity: 7,
    poolPages: 256,
  })
  // The set holds the throttle of more slots than its layout asks.
  const old = throttleMade(fake, 2 * res.layout.mapSlots)
  old.prevKept = true
  res.throttle = old
  fake.copies.length = 0
  const smaller = vsmThrottleState(fake.device, res)
  assert.notEqual(smaller, old, 'made again')
  assert.deepEqual(fake.copies, [], 'no copy, not even in part')
  assert.equal(smaller.prevKept, false, 'the history restarts')
})
