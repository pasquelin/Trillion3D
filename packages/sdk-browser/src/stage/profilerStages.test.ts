// The stage profile: what its deposits, rings, reasons and counts publish.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createStageProfiler, cpuStepTable } from './profiler.ts'
import { GEOMETRY, LIGHTS, file, profilerOf } from './profiler.fixture.ts'

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
