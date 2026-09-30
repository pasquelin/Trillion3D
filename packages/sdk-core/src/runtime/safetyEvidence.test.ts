import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafetyPolicy, type MeasuredCosts, type SafetyConfig } from './safety.ts';

const config: SafetyConfig = {
  minimumSamples: 1,
  minimumPeriodMs: 0,
  disableRatio: 1.2,
  enableRatio: 0.8,
  consecutiveViolations: 1,
};
const reference: MeasuredCosts = {
  contextKey: 'scene-1',
  provenance: 'measured',
  cpuMs: 10,
  gpuMs: 10,
  latencyMs: 10,
  memoryBytes: 10,
  evictionsPerSecond: 0,
};
const faster: MeasuredCosts = { ...reference, cpuMs: 5, gpuMs: 5, latencyMs: 5 };

test('a single incomparable field in either measurement disables the feature', () => {
  for (const patch of [
    { contextKey: 'other' },
    { provenance: 'estimated' },
    ...['cpuMs', 'gpuMs', 'latencyMs', 'memoryBytes', 'evictionsPerSecond'].flatMap((field) =>
      [-1, NaN, Infinity].map((value) => ({ [field]: value })),
    ),
  ])
    for (const side of ['reference', 'candidate']) {
      const policy = createSafetyPolicy(config);
      assert.equal(policy.observe(reference, faster, 1).enabled, true);
      const left = side === 'reference' ? { ...reference, ...patch } : reference;
      const right = side === 'candidate' ? { ...faster, ...patch } : faster;
      const decision = policy.observe(left as MeasuredCosts, right as MeasuredCosts, 2);
      assert.equal(decision.enabled, false);
      assert.equal(decision.reason, 'Incomparable or invalid evidence');
    }
});

test('GPU and memory requirements distinguish unmeasured from zero', () => {
  for (const side of ['reference', 'candidate']) {
    const policy = createSafetyPolicy({ ...config, requireGpuTiming: true });
    const decision = policy.observe(
      side === 'reference' ? { ...reference, gpuMs: null } : reference,
      side === 'candidate' ? { ...faster, gpuMs: null } : faster,
      1,
    );
    assert.equal(decision.enabled, false);
    assert.equal(decision.reason, 'GPU evidence unavailable');
  }
  assert.equal(
    createSafetyPolicy({ ...config, requireGpuTiming: true }).observe(
      reference,
      { ...faster, gpuMs: 0 },
      1,
    ).enabled,
    true,
  );
  const missing = createSafetyPolicy({ ...config, memoryBudgetBytes: 20 }).observe(
    reference,
    { ...faster, memoryBytes: null },
    1,
  );
  assert.equal(missing.reason, 'Memory evidence unavailable');
  assert.equal(missing.enabled, false);
  assert.equal(
    createSafetyPolicy(config).observe(reference, { ...faster, memoryBytes: null, gpuMs: null }, 1)
      .enabled,
    true,
  );
});

test('memory and eviction limits are inclusive and trip immediately only above the budget', () => {
  for (const [field, option, reason] of [
    ['memoryBytes', 'memoryBudgetBytes', 'Circuit breaker: memory budget'],
    ['evictionsPerSecond', 'maxEvictionsPerSecond', 'Circuit breaker: thrashing'],
  ]) {
    const policy = createSafetyPolicy({ ...config, [option]: 20 });
    assert.equal(policy.observe(reference, { ...faster, [field]: 20 }, 1).enabled, true);
    const decision = policy.observe(reference, { ...faster, [field]: 21 }, 2);
    assert.equal(decision.enabled, false);
    assert.equal(decision.reason, reason);
    const unconstrained = createSafetyPolicy(config).observe(
      reference,
      { ...faster, [field]: 1000 },
      1,
    );
    assert.equal(unconstrained.enabled, true);
  }
  assert.equal(
    createSafetyPolicy({ ...config, maxEvictionsPerSecond: 20 }).observe(
      reference,
      { ...faster, evictionsPerSecond: null },
      1,
    ).enabled,
    true,
  );
});

test('zero reference durations cannot make added work beneficial', () => {
  const zero = { ...reference, cpuMs: 0, gpuMs: 0, latencyMs: 0 };
  const policy = createSafetyPolicy({ ...config, enableRatio: 1 });
  assert.equal(policy.observe(zero, zero, 0).enabled, true);
  assert.equal(policy.observe(zero, { ...zero, cpuMs: 1 }, 1).enabled, false);
});

test('each cost channel can veto a benefit or disable an enabled feature', () => {
  for (const field of ['cpuMs', 'gpuMs', 'latencyMs']) {
    const policy = createSafetyPolicy(config);
    assert.equal(policy.observe(reference, { ...faster, [field]: 9 }, 1).enabled, false);
    assert.equal(policy.observe(reference, faster, 2).enabled, true);
    const decision = policy.observe(reference, { ...faster, [field]: 13 }, 3);
    assert.equal(decision.enabled, false);
    assert.equal(decision.reason, 'Measured cost exceeds reference');
  }
});

test('optional GPU measurements are compared only when both sides have a duration', () => {
  for (const [left, right] of [
    [null, null],
    [null, 0],
    [null, 5],
    [0, null],
    [10, null],
  ]) {
    const policy = createSafetyPolicy(config);
    assert.equal(
      policy.observe({ ...reference, gpuMs: left }, { ...faster, gpuMs: right }, 1).enabled,
      true,
    );
  }
});

test('a candidate exactly at the disabling ratio remains enabled', () => {
  const policy = createSafetyPolicy(config);
  assert.equal(policy.observe(reference, faster, 1).enabled, true);
  assert.equal(policy.observe(reference, { ...faster, cpuMs: 12 }, 2).enabled, true);
  assert.equal(policy.observe(reference, { ...faster, cpuMs: 12.01 }, 3).enabled, false);
});
