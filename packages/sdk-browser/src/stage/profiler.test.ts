import test from 'node:test'
import assert from 'node:assert/strict'
import { createStageProfiler, cpuStepTable } from './profiler.ts'

const TWO = cpuStepTable([
  ['aMs', 'lights'],
  ['bMs', 'geometry'],
] as const)
/** The indices of the two stages the profiles below publish. */
const LIGHTS = 0,
  GEOMETRY = 1

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
  const window = profiler.openWindow()
  const profile = profiler.profile()
  assert.equal(profile.cpuFrames, 0)
  assert.equal(profile.gpuSamples, 0)
  assert.equal(profile.gpuImageMs, null)
  assert.equal(profile.overheadMs, null)
  for (const entry of profile.stages) {
    assert.equal(entry.cpuMs, null)
    assert.equal(entry.gpuMs, null)
  }
  assert.equal(window.read(), null)
})

test('an unmounted stage profile has no deposits, still files the bounds, and publishes itself disabled', () => {
  const profiler = profilerOf({ staged: false })
  const window = profiler.openWindow()
  file(profiler, 1, 1, 2)
  assert.equal(profiler.stages, undefined)
  const profile = profiler.profile()
  assert.equal(profile.enabled, false)
  assert.equal(profile.gpuReason, 'per-stage profile not requested by the host')
  assert.deepEqual(profile.stages, [])
  assert.equal(window.read()?.frames, 1)
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
  profiler.stages!.frameGpu((add) => {
    add(LIGHTS, 1)
    add(LIGHTS, 2)
  })
  assert.deepEqual(profiler.profile().stages[0].gpuMs, { p50: 3, p95: 3 })
})

test('a deposit onto a stage the profile does not publish is dropped', () => {
  const profiler = profilerOf()
  profiler.stages!.frameGpu((add) => {
    add(-1, 4)
    add(2, 4)
    add(GEOMETRY, 1)
  })
  const [lights, geometry] = profiler.profile().stages
  assert.equal(lights.gpuMs, null)
  assert.deepEqual(geometry.gpuMs, { p50: 1, p95: 1 })
})

test('the stage ring keeps only the window: the oldest values are forgotten', () => {
  const profiler = profilerOf({ window: 8 })
  for (let i = 1; i <= 10; i++) file(profiler, i, i, NaN)
  const entry = profiler.profile().stages[0]
  // Window of 8: only 3..10 remain.
  assert.deepEqual(entry.cpuMs, { p50: 6, p95: 10 })
})

test('the stage reset forgets the stage window alone, never a bound window', () => {
  const profiler = profilerOf()
  const window = profiler.openWindow()
  file(profiler, 1, 5, 1)
  profiler.stages!.frameGpu((add) => add(LIGHTS, 7))
  profiler.stages!.pushImageGpu(9)
  profiler.stages!.reset()
  const profile = profiler.profile()
  assert.equal(profile.cpuFrames, 0)
  assert.equal(profile.gpuSamples, 0)
  assert.equal(profile.gpuImageMs, null)
  assert.equal(profile.stages[0].cpuMs, null)
  assert.equal(profile.stages[0].gpuMs, null)
  assert.equal(window.read()?.frames, 1)
})

test("a window's reset opens it again unread, and leaves every other window as it was", () => {
  const profiler = profilerOf()
  const host = profiler.openWindow(),
    published = profiler.openWindow()
  file(profiler, 1, 5, 1)
  host.reset()
  assert.equal(host.read(), null)
  assert.equal(published.read()?.frames, 1)
})

test('a window opened late reads only the images filed after it opened', () => {
  const profiler = profilerOf()
  file(profiler, 1, 5, 1)
  const late = profiler.openWindow()
  assert.equal(late.read(), null)
  file(profiler, 2, 6, 1)
  assert.deepEqual(
    late.read()?.worst.map((entry) => entry.frame),
    [2],
  )
})

test('setReason fills the reason only for the column that stayed unmeasured', () => {
  const profiler = profilerOf()
  file(profiler, 1, 1, NaN)
  profiler.stages!.setReason('lights', { cpu: 'never seen', gpu: 'device without timestamps' })
  const entry = profiler.profile().stages[0]
  assert.equal(entry.cpuReason, undefined)
  assert.equal(entry.gpuReason, 'device without timestamps')
})

test('setCounts attaches counters to the stage, on top of the durations', () => {
  const profiler = profilerOf()
  profiler.stages!.setCounts('lights', { facesRedrawn: 12 })
  assert.deepEqual(profiler.profile().stages[0].counts, { facesRedrawn: 12 })
})

test('setGpuMethod changes the method and reason the profile publishes', () => {
  const profiler = profilerOf()
  profiler.stages!.setGpuMethod('timestamp-query', null)
  assert.equal(profiler.profile().gpuMethod, 'timestamp-query')
  profiler.stages!.setGpuMethod(null, 'incompatible device')
  assert.equal(profiler.profile().gpuReason, 'incompatible device')
})

test('negative or non-finite durations are ignored, never deposited as a zero', () => {
  const profiler = profilerOf()
  file(profiler, 1, NaN, -1)
  profiler.stages!.pushImageGpu(NaN)
  const profile = profiler.profile()
  assert.equal(profile.stages[0].cpuMs, null)
  assert.equal(profile.stages[1].cpuMs, null)
  assert.equal(profile.gpuImageMs, null)
})

test('a window ranks the worst images by total, reports a percentile per bound, and forgets both', () => {
  const profiler = profilerOf({ worst: 2 })
  const published = profiler.openWindow(),
    host = profiler.openWindow()
  for (let frame = 1; frame <= 5; frame++) {
    profiler.row[0] = frame
    profiler.row[1] = 10 - frame
    profiler.record(frame, frame)
  }
  const summary = published.read()!
  assert.equal(summary.frames, 5)
  assert.deepEqual(summary.steps.aMs, { p50: 3, p95: 5, max: 5 })
  assert.deepEqual(summary.steps.bMs, { p50: 7, p95: 9, max: 9 })
  assert.deepEqual(
    summary.worst.map((entry) => entry.frame),
    [5, 4],
  )
  assert.equal(summary.worst[0].aMs, 5)
  assert.equal(published.read(), null)
  assert.equal(host.read()?.frames, 5, 'the other window still holds every image')
})

test('a bound an image did not file stays out of its quantiles; one no image filed reads NaN', () => {
  const profiler = profilerOf()
  const window = profiler.openWindow()
  for (const ms of [0.3, NaN, NaN, 0.1]) file(profiler, 1, ms, NaN)
  const summary = window.read()!
  assert.equal(summary.frames, 4, 'the images are all filed')
  assert.deepEqual(summary.steps.aMs, { p50: 0.1, p95: 0.3, max: 0.3 })
  assert.ok(Object.values(summary.steps.bMs).every(Number.isNaN), 'unmeasured, never zero')
})

test('the bound ring keeps the most recent images once capacity is reached', () => {
  const profiler = profilerOf({ stepCapacity: 2, worst: 1 })
  const window = profiler.openWindow()
  for (const value of [1, 2, 3]) file(profiler, value, value, NaN)
  const summary = window.read()!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 2, p95: 3, max: 3 })
  assert.equal(summary.worst[0].frame, 3)
})

test('a window reset after the ring wrapped reads only its own images', () => {
  const profiler = profilerOf({ stepCapacity: 4 })
  const window = profiler.openWindow()
  for (const value of [1, 2, 3, 4, 5]) file(profiler, value, value, NaN)
  window.reset()
  for (const value of [6, 7]) file(profiler, value, value, NaN)
  const summary = window.read()!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 6, p95: 7, max: 7 })
})
