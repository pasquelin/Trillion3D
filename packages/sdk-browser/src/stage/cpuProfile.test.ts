import test from 'node:test'
import assert from 'node:assert/strict'
import { stageQuantiles } from '../../../sdk-core/src/runtime/stageProfile.ts'
import { createCpuStepProfile } from './cpuProfile.ts'

test('a summary ranks the worst images by total, reports a percentile per step, and forgets both', () => {
  const profile = createCpuStepProfile(['aMs', 'bMs'], { worst: 2 })
  for (let frame = 1; frame <= 5; frame++) {
    profile.row[0] = frame
    profile.row[1] = 10 - frame
    profile.record(frame, frame)
  }
  const summary = profile.summary()!
  assert.equal(summary.frames, 5)
  assert.deepEqual(summary.steps.aMs, { p50: 3, p95: 5, max: 5 })
  assert.deepEqual(summary.steps.bMs, { p50: 7, p95: 9, max: 9 })
  assert.deepEqual(
    summary.worst.map((entry) => entry.frame),
    [5, 4],
  )
  assert.equal(summary.worst[0].aMs, 5)
  assert.equal(profile.summary(), null)
})

test('a bound an image did not file stays out of its quantiles; one no image filed reads NaN', () => {
  const profile = createCpuStepProfile(['aMs', 'bMs'])
  for (const ms of [0.3, NaN, NaN, 0.1]) {
    profile.row[0] = ms
    profile.row[1] = NaN
    profile.record(1, 1)
  }
  const summary = profile.summary()!
  assert.equal(summary.frames, 4, 'the images are all filed')
  assert.deepEqual(summary.steps.aMs, { p50: 0.1, p95: 0.3, max: 0.3 })
  assert.ok(Object.values(summary.steps.bMs).every(Number.isNaN), 'unmeasured, never zero')
})

test('the ring keeps the most recent images once capacity is reached', () => {
  const profile = createCpuStepProfile(['aMs'], { capacity: 2, worst: 1 })
  for (const value of [1, 2, 3]) {
    profile.row[0] = value
    profile.record(value, value)
  }
  const summary = profile.summary()!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 2, p95: 3, max: 3 })
})

test('the CPU step profile and the stage profile read the same p50 and p95 from the same samples', () => {
  // 20 samples: the nearest rank of p95 is the 19th, where a next-element rule read the 20th.
  const samples = Array.from({ length: 20 }, (_, i) => i + 1)
  const profile = createCpuStepProfile(['aMs'], { capacity: samples.length })
  for (const ms of samples) {
    profile.row[0] = ms
    profile.record(ms, ms)
  }
  const { p50, p95 } = profile.summary()!.steps.aMs
  assert.deepEqual({ p50, p95 }, stageQuantiles(samples))
  assert.equal(p95, 19)
})
