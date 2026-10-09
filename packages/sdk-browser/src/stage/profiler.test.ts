import test from 'node:test'
import assert from 'node:assert/strict'
import { createStageProfiler, cpuStepTable } from './profiler.ts'

const TWO = cpuStepTable([
  ['aMs', 'lights'],
  ['bMs', 'geometry'],
] as const)

/** A profiler whose two bounds deposit onto `lights` and `geometry`, staged unless told not to. */
const profilerOf = (
  options: { staged?: boolean; window?: number; stepCapacity?: number; worst?: number } = {},
) =>
  createStageProfiler({
    backend: 'webgpu',
    steps: TWO,
    stages: options.staged === false ? undefined : ['lights', 'geometry'],
    gpuMethod: null,
    window: options.window,
    stepCapacity: options.stepCapacity,
    worst: options.worst,
  })

/** Files one image whose bounds are `a` and `b`. */
function file(profiler: ReturnType<typeof profilerOf>, frame: number, a: number, b: number) {
  profiler.row[0] = a
  profiler.row[1] = b
  profiler.record(frame, a)
}

test('a never-fed profile costs nothing: everything stays unmeasured', () => {
  const profiler = profilerOf()
  const profile = profiler.profile()
  assert.equal(profile.cpuFrames, 0)
  assert.equal(profile.gpuSamples, 0)
  assert.equal(profile.gpuImageMs, null)
  assert.equal(profile.overheadMs, null)
  for (const entry of profile.stages) {
    assert.equal(entry.cpuMs, null)
    assert.equal(entry.gpuMs, null)
  }
  assert.equal(profiler.steps('published'), null)
  assert.equal(profiler.steps('host'), null)
})

test('an unmounted stage profile still files the bounds, and publishes itself disabled', () => {
  const profiler = profilerOf({ staged: false })
  file(profiler, 1, 1, 2)
  profiler.frameGpu((add) => add('lights', 3))
  const profile = profiler.profile()
  assert.equal(profile.enabled, false)
  assert.deepEqual(profile.stages, [])
  assert.equal(profiler.steps('host')?.frames, 1)
})

test('bounds of the same stage sum before entering the ring; a sum deposits nowhere', () => {
  const profiler = createStageProfiler({
    backend: 'webgpu',
    steps: cpuStepTable([
      ['aMs', 'lights'],
      ['bMs', 'lights'],
      ['totalMs', null],
    ] as const),
    stages: ['lights'],
    gpuMethod: null,
  })
  profiler.row.set([1, 2, 3])
  profiler.record(1, 3)
  const entry = profiler.profile().stages[0]
  assert.deepEqual(entry.cpuMs, { p50: 3, p95: 3 })
  assert.equal(profiler.profile().cpuFrames, 1)
  profiler.frameGpu((add) => {
    add('lights', 1)
    add('lights', 2)
  })
  assert.deepEqual(profiler.profile().stages[0].gpuMs, { p50: 3, p95: 3 })
})

test('the stage ring keeps only the window: the oldest values are forgotten', () => {
  const profiler = profilerOf({ window: 8 })
  for (let i = 1; i <= 10; i++) file(profiler, i, i, NaN)
  const entry = profiler.profile().stages[0]
  // Window of 8: only 3..10 remain.
  assert.deepEqual(entry.cpuMs, { p50: 6, p95: 10 })
})

test('reset forgets the stage window and the host window, never the published one', () => {
  const profiler = profilerOf()
  file(profiler, 1, 5, 1)
  profiler.frameGpu((add) => add('lights', 7))
  profiler.pushImageGpu(9)
  profiler.reset()
  const profile = profiler.profile()
  assert.equal(profile.cpuFrames, 0)
  assert.equal(profile.gpuSamples, 0)
  assert.equal(profile.gpuImageMs, null)
  assert.equal(profile.stages[0].cpuMs, null)
  assert.equal(profile.stages[0].gpuMs, null)
  assert.equal(profiler.steps('host'), null)
  assert.equal(profiler.steps('published')?.frames, 1)
})

test('setReason fills the reason only for the column that stayed unmeasured', () => {
  const profiler = profilerOf()
  file(profiler, 1, 1, NaN)
  profiler.setReason('lights', { cpu: 'never seen', gpu: 'device without timestamps' })
  const entry = profiler.profile().stages[0]
  assert.equal(entry.cpuReason, undefined)
  assert.equal(entry.gpuReason, 'device without timestamps')
})

test('setCounts attaches counters to the stage, on top of the durations', () => {
  const profiler = profilerOf()
  profiler.setCounts('lights', { facesRedrawn: 12 })
  assert.deepEqual(profiler.profile().stages[0].counts, { facesRedrawn: 12 })
})

test('setGpuMethod changes the method and reason the profile publishes', () => {
  const profiler = profilerOf()
  profiler.setGpuMethod('timestamp-query', null)
  assert.equal(profiler.profile().gpuMethod, 'timestamp-query')
  profiler.setGpuMethod(null, 'incompatible device')
  assert.equal(profiler.profile().gpuReason, 'incompatible device')
})

test('negative or non-finite durations are ignored, never deposited as a zero', () => {
  const profiler = profilerOf()
  file(profiler, 1, NaN, -1)
  profiler.pushImageGpu(NaN)
  const profile = profiler.profile()
  assert.equal(profile.stages[0].cpuMs, null)
  assert.equal(profile.stages[1].cpuMs, null)
  assert.equal(profile.gpuImageMs, null)
})

test('a window ranks the worst images by total, reports a percentile per bound, and forgets both', () => {
  const profiler = profilerOf({ worst: 2 })
  for (let frame = 1; frame <= 5; frame++) {
    profiler.row[0] = frame
    profiler.row[1] = 10 - frame
    profiler.record(frame, frame)
  }
  const summary = profiler.steps('published')!
  assert.equal(summary.frames, 5)
  assert.deepEqual(summary.steps.aMs, { p50: 3, p95: 5, max: 5 })
  assert.deepEqual(summary.steps.bMs, { p50: 7, p95: 9, max: 9 })
  assert.deepEqual(
    summary.worst.map((entry) => entry.frame),
    [5, 4],
  )
  assert.equal(summary.worst[0].aMs, 5)
  assert.equal(profiler.steps('published'), null)
  assert.equal(profiler.steps('host')?.frames, 5, 'the other window still holds every image')
})

test('a bound an image did not file stays out of its quantiles; one no image filed reads NaN', () => {
  const profiler = profilerOf()
  for (const ms of [0.3, NaN, NaN, 0.1]) file(profiler, 1, ms, NaN)
  const summary = profiler.steps('host')!
  assert.equal(summary.frames, 4, 'the images are all filed')
  assert.deepEqual(summary.steps.aMs, { p50: 0.1, p95: 0.3, max: 0.3 })
  assert.ok(Object.values(summary.steps.bMs).every(Number.isNaN), 'unmeasured, never zero')
})

test('the bound ring keeps the most recent images once capacity is reached', () => {
  const profiler = profilerOf({ stepCapacity: 2, worst: 1 })
  for (const value of [1, 2, 3]) file(profiler, value, value, NaN)
  const summary = profiler.steps('published')!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 2, p95: 3, max: 3 })
  assert.equal(summary.worst[0].frame, 3)
})

test('a window opened after the ring wrapped reads only its own images', () => {
  const profiler = profilerOf({ stepCapacity: 4 })
  for (const value of [1, 2, 3, 4, 5]) file(profiler, value, value, NaN)
  profiler.reset()
  for (const value of [6, 7]) file(profiler, value, value, NaN)
  const summary = profiler.steps('host')!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 6, p95: 7, max: 7 })
})

test('the bound windows and the stage profile read the same p50 and p95 from the same images', () => {
  // 20 images: the nearest rank of p95 is the 19th, where a next-element rule read the 20th.
  const profiler = profilerOf({ window: 20 })
  for (let ms = 1; ms <= 20; ms++) file(profiler, ms, ms, NaN)
  const { p50, p95 } = profiler.steps('host')!.steps.aMs
  assert.deepEqual({ p50, p95 }, profiler.profile().stages[0].cpuMs)
  assert.equal(p95, 19)
})
