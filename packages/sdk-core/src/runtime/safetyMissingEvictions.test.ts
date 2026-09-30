import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafetyPolicy, type MeasuredCosts } from './safety.ts';

test('missing eviction evidence never fabricates thrashing even for an accepted negative ceiling', () => {
  const policy = createSafetyPolicy({
    minimumSamples: 1,
    minimumPeriodMs: 0,
    consecutiveViolations: 1,
    disableRatio: 2,
    enableRatio: 0.5,
    maxEvictionsPerSecond: -1,
  });
  const reference: MeasuredCosts = {
    contextKey: 'unknown-evictions',
    provenance: 'measured',
    cpuMs: 20,
    gpuMs: null,
    latencyMs: 20,
    memoryBytes: null,
    evictionsPerSecond: 0,
  };
  const candidate = { ...reference, cpuMs: 5, latencyMs: 5, evictionsPerSecond: null };
  const unknown = policy.observe(reference, candidate, 1);
  assert.equal(unknown.enabled, true);
  assert.equal(unknown.reason, 'Measured benefit within configured budgets');
  const measured = policy.observe(reference, { ...candidate, evictionsPerSecond: 0 }, 2);
  assert.equal(measured.enabled, false);
  assert.equal(measured.reason, 'Circuit breaker: thrashing');
});
