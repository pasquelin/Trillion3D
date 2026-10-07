import test from 'node:test'
import assert from 'node:assert/strict'
import { stageQuantiles, stageLabel, disabledStageProfile, STAGE_LABELS } from './stageProfile.ts'
import { WEBGPU_STAGES } from '../../../sdk-browser/src/stage/mapping.ts'

test('stageQuantiles returns null for an empty series: unmeasured, not zero', () => {
  assert.equal(stageQuantiles([]), null)
})

test('stageQuantiles distinguishes a measured zero from the unmeasured', () => {
  const quantiles = stageQuantiles([0, 0, 0])
  assert.deepEqual(quantiles, { p50: 0, p95: 0 })
  assert.notEqual(quantiles, null)
})

test('stageQuantiles computes p50 and p95 from the series', () => {
  assert.deepEqual(stageQuantiles([10, 20, 30, 40, 60]), { p50: 30, p95: 60 })
})

test('every stage the engine records reads as its own words, and every label names such a stage', () => {
  const recorded = new Set<string>(WEBGPU_STAGES)
  for (const stage of recorded) {
    assert.notEqual(stageLabel(stage).trim(), '', `${stage} has words`)
    assert.notEqual(stageLabel(stage), stage, `${stage} is not shown as its key`)
  }
  const labels = Object.values(STAGE_LABELS)
  assert.equal(new Set(labels).size, labels.length, 'no two stages read the same')
  assert.deepEqual(Object.keys(STAGE_LABELS).sort(), [...recorded].sort())
  assert.ok(Object.isFrozen(STAGE_LABELS))
})

test('a stage no engine names is shown as it is', () => {
  assert.equal(stageLabel('host-custom-stage'), 'host-custom-stage')
})

test('disabledStageProfile measures nothing: counters at zero, quantiles and method at null', () => {
  const profile = disabledStageProfile('webgpu', 'per-stage profile not requested by the host')
  assert.deepEqual(profile, {
    version: 1,
    enabled: false,
    backend: 'webgpu',
    cpuFrames: 0,
    gpuSamples: 0,
    windowFrames: 0,
    gpuMethod: null,
    gpuReason: 'per-stage profile not requested by the host',
    gpuImageMs: null,
    overheadMs: null,
    stages: [],
  })
})
