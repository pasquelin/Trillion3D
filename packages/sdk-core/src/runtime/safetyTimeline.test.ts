import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafetyPolicy, type MeasuredCosts } from './safety.ts';

const reference: MeasuredCosts = {
  contextKey: 'scene',
  provenance: 'measured',
  cpuMs: 10,
  gpuMs: 10,
  latencyMs: 10,
  memoryBytes: 0,
  evictionsPerSecond: 0,
};
const candidate = (time: number): MeasuredCosts => ({
  ...reference,
  cpuMs: time,
  gpuMs: time,
  latencyMs: time,
});
const config = {
  minimumSamples: 2,
  consecutiveViolations: 2,
  minimumPeriodMs: 10,
  enableRatio: 0.8,
  disableRatio: 1.2,
};

test('hysteresis treats enabling and disabling thresholds differently and respects the exact period boundary', () => {
  const policy = createSafetyPolicy(config);
  assert.equal(policy.observe(reference, candidate(8), 1).enabled, false);
  assert.equal(policy.observe(reference, candidate(8), 2).enabled, false);
  const on = policy.observe(reference, candidate(8), 10);
  assert.equal(on.enabled, true);
  assert.equal(on.tier, 'full');
  assert.equal(on.revision, 1);
  assert.equal(on.changedAt, 10);
  assert.equal(on.reason, 'Measured benefit within configured budgets');
  assert.equal(policy.observe(reference, candidate(12), 11), on);
  assert.equal(policy.observe(reference, candidate(13), 12), on);
  const off = policy.observe(reference, candidate(13), 20);
  assert.equal(off.enabled, false);
  assert.equal(off.changedAt, 20);
  assert.equal(off.revision, 2);
});

test('neutral or invalid evidence resets consecutive samples rather than accumulating across interruptions', () => {
  const policy = createSafetyPolicy({ ...config, minimumPeriodMs: 0 });
  assert.equal(policy.observe(reference, candidate(8), 0).enabled, false);
  assert.equal(policy.observe(reference, candidate(10), 1).enabled, false);
  assert.equal(policy.observe(reference, candidate(8), 2).enabled, false);
  assert.equal(policy.observe(reference, candidate(8), 3).enabled, true);
  assert.equal(policy.observe(reference, candidate(13), 4).enabled, true);
  assert.equal(policy.observe(reference, candidate(10), 5).enabled, true);
  assert.equal(policy.observe(reference, candidate(13), 6).enabled, true);
  assert.equal(policy.observe(reference, candidate(13), 7).enabled, false);
  policy.observe(reference, candidate(8), 8);
  policy.observe(reference, { ...candidate(8), contextKey: 'different' }, 9);
  assert.equal(policy.observe(reference, candidate(8), 10).enabled, false);
  assert.equal(policy.observe(reference, candidate(8), 11).enabled, true);
});

test('observations reject invalid clocks and accept equal timestamps', () => {
  const policy = createSafetyPolicy({ ...config, minimumPeriodMs: 0 });
  policy.observe(reference, candidate(8), 10);
  assert.equal(policy.observe(reference, candidate(8), 10).enabled, true);
  for (const time of [9, NaN, Infinity, -Infinity])
    assert.throws(() => policy.observe(reference, candidate(8), time), /INVALID_CLOCK/);
});
