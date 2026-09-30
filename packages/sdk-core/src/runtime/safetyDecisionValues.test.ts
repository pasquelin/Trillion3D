import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafetyPolicy, type MeasuredCosts } from './safety.ts';

test('fresh measured evidence restores the enabled decision after a consumer changes it', () => {
  const policy = createSafetyPolicy({
    minimumSamples: 1,
    minimumPeriodMs: 0,
    disableRatio: 1.2,
    enableRatio: 0.8,
    consecutiveViolations: 1,
  });
  const reference: MeasuredCosts = {
    contextKey: 'device',
    provenance: 'measured',
    cpuMs: 10,
    gpuMs: 10,
    latencyMs: 10,
    memoryBytes: 10,
    evictionsPerSecond: 0,
  };
  const candidate = { ...reference, cpuMs: 1, gpuMs: 1, latencyMs: 1 };
  assert.equal(policy.observe(reference, candidate, 0).enabled, true);
  const previous = policy.getDecision();
  previous.enabled = false;
  const next = policy.observe(reference, candidate, 1);
  assert.equal(next.enabled, true);
  assert.equal(next.tier, 'full');
  assert.equal(next.changedAt, 1);
  assert.equal(next.revision, previous.revision + 1);
  assert.equal(previous.enabled, false, 'a transition replaces the old decision');
});
