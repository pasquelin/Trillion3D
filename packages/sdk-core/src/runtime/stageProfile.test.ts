import test from 'node:test';
import assert from 'node:assert/strict';
import { stageQuantiles, stageLabel, disabledStageProfile } from './stageProfile.ts';

test('stageQuantiles returns null for an empty series: unmeasured, not zero', () => {
  assert.equal(stageQuantiles([]), null);
});

test('stageQuantiles distinguishes a measured zero from the unmeasured', () => {
  const quantiles = stageQuantiles([0, 0, 0]);
  assert.deepEqual(quantiles, { p50: 0, p95: 0 });
  assert.notEqual(quantiles, null);
});

test('stageQuantiles computes p50 and p95 from the series', () => {
  assert.deepEqual(stageQuantiles([10, 20, 30, 40, 60]), { p50: 30, p95: 60 });
});

test('stageLabel returns the known label and the stage as-is if it is unknown', () => {
  assert.equal(stageLabel('hiZ'), 'Hi-Z (occlusion)');
  assert.equal(stageLabel('etapeInconnue'), 'etapeInconnue');
});

test('disabledStageProfile measures nothing: counters at zero, quantiles and method at null', () => {
  const profile = disabledStageProfile('webgl2', 'per-stage profile not requested by the host');
  assert.equal(profile.enabled, false);
  assert.equal(profile.backend, 'webgl2');
  assert.equal(profile.cpuFrames, 0);
  assert.equal(profile.gpuSamples, 0);
  assert.equal(profile.windowFrames, 0);
  assert.equal(profile.gpuMethod, null);
  assert.equal(profile.gpuReason, 'per-stage profile not requested by the host');
  assert.equal(profile.gpuImageMs, null);
  assert.equal(profile.overheadMs, null);
  assert.deepEqual(profile.stages, []);
});
