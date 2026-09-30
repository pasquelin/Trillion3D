import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafetyPolicy, type MeasuredCosts, type SafetyConfig } from './safety.ts';

/** Decides on one sample, at once, with no switching period. */
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
/** The reference with every duration set to `ms`. */
const timed = (ms: number): MeasuredCosts => ({
  ...reference,
  cpuMs: ms,
  gpuMs: ms,
  latencyMs: ms,
});
const faster = timed(5);
/** Two samples to switch either way. */
const hysteresis = { ...config, minimumSamples: 2, consecutiveViolations: 2 };

test('safety policy refuses each invalid bound independently', () => {
  const invalid: Partial<Record<keyof SafetyConfig, number[]>> = {
    minimumSamples: [0, -1, 1.5, NaN, Infinity],
    consecutiveViolations: [0, -1, 1.5, NaN, Infinity],
    minimumPeriodMs: [-1, NaN, Infinity],
    enableRatio: [0, -0.1, NaN, Infinity, config.disableRatio, config.disableRatio + 0.1],
    disableRatio: [NaN, Infinity, config.enableRatio, config.enableRatio - 0.1],
    memoryBudgetBytes: [-1, NaN, Infinity],
    maxEvictionsPerSecond: [-1, NaN, Infinity],
  };
  for (const [field, values] of Object.entries(invalid))
    for (const value of values)
      assert.throws(
        () => createSafetyPolicy({ ...config, [field]: value }),
        /INVALID_SAFETY_POLICY/,
        `${field}: ${value}`,
      );
  assert.doesNotThrow(() => createSafetyPolicy(config));
  assert.doesNotThrow(() =>
    createSafetyPolicy({ ...config, memoryBudgetBytes: 0, maxEvictionsPerSecond: 0 }),
  );
});

test('the initial decision describes unmeasured disabled work and circuit breakers name their cause', () => {
  const policy = createSafetyPolicy(config);
  assert.deepEqual(policy.getDecision(), {
    tier: 'baseline',
    enabled: false,
    reason: 'No comparable measured evidence',
    changedAt: 0,
    revision: 0,
  });
  const causes = ['error', 'oom', 'device-lost', 'thrashing', 'quality-failed'] as const;
  for (const [i, cause] of causes.entries()) {
    const decision = policy.trip(cause, i + 1);
    assert.deepEqual(decision, {
      tier: 'baseline',
      enabled: false,
      reason: `Circuit breaker: ${cause}`,
      changedAt: i + 1,
      revision: i + 1,
    });
    assert.equal(policy.getDecision(), decision);
    assert.equal(policy.trip(cause, i + 1), decision);
  }
});

test('Optimization requires comparable evidence, uses hysteresis, and trips immediately on errors', () => {
  const p = createSafetyPolicy({ ...hysteresis, minimumPeriodMs: 100 });
  assert.equal(p.observe(reference, timed(8), 100).enabled, false);
  assert.equal(p.observe(reference, timed(8), 110).enabled, true);
  assert.equal(p.observe(reference, timed(13), 120).enabled, true);
  assert.equal(p.observe(reference, timed(13), 130).enabled, true);
  assert.equal(p.observe(reference, timed(13), 220).enabled, false);
  assert.equal(p.observe(reference, timed(8), 230).enabled, false);
  assert.equal(p.observe(reference, timed(8), 330).enabled, true);
  assert.equal(p.trip('device-lost', 331).enabled, false);
});

test('hysteresis treats enabling and disabling thresholds differently and respects the exact period boundary', () => {
  const policy = createSafetyPolicy({ ...hysteresis, minimumPeriodMs: 10 });
  assert.equal(policy.observe(reference, timed(8), 1).enabled, false);
  assert.equal(policy.observe(reference, timed(8), 2).enabled, false);
  const on = policy.observe(reference, timed(8), 10);
  assert.deepEqual(on, {
    tier: 'full',
    enabled: true,
    reason: 'Measured benefit within configured budgets',
    changedAt: 10,
    revision: 1,
  });
  assert.equal(policy.observe(reference, timed(12), 11), on);
  assert.equal(policy.observe(reference, timed(13), 12), on);
  const off = policy.observe(reference, timed(13), 20);
  assert.equal(off.enabled, false);
  assert.equal(off.changedAt, 20);
  assert.equal(off.revision, 2);
});

test('neutral or invalid evidence resets consecutive samples rather than accumulating across interruptions', () => {
  const policy = createSafetyPolicy(hysteresis);
  assert.equal(policy.observe(reference, timed(8), 0).enabled, false);
  assert.equal(policy.observe(reference, timed(10), 1).enabled, false);
  assert.equal(policy.observe(reference, timed(8), 2).enabled, false);
  assert.equal(policy.observe(reference, timed(8), 3).enabled, true);
  assert.equal(policy.observe(reference, timed(13), 4).enabled, true);
  assert.equal(policy.observe(reference, timed(10), 5).enabled, true);
  assert.equal(policy.observe(reference, timed(13), 6).enabled, true);
  assert.equal(policy.observe(reference, timed(13), 7).enabled, false);
  policy.observe(reference, timed(8), 8);
  policy.observe(reference, { ...timed(8), contextKey: 'different' }, 9);
  assert.equal(policy.observe(reference, timed(8), 10).enabled, false);
  assert.equal(policy.observe(reference, timed(8), 11).enabled, true);
});

test('observations and circuit breakers reject invalid clocks and accept equal timestamps', () => {
  const policy = createSafetyPolicy(config);
  policy.observe(reference, faster, 10);
  assert.equal(policy.observe(reference, faster, 10).enabled, true);
  const tripped = policy.trip('error', 10);
  assert.equal(policy.trip('error', 10), tripped);
  for (const time of [9, NaN, Infinity, -Infinity]) {
    assert.throws(() => policy.observe(reference, faster, time), /INVALID_CLOCK/);
    assert.throws(() => policy.trip('oom', time), /INVALID_CLOCK/);
  }
});

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
});

test('an unmeasured eviction rate never fabricates thrashing, even under a zero ceiling', () => {
  const policy = createSafetyPolicy({ ...config, maxEvictionsPerSecond: 0 });
  const unknown = policy.observe(reference, { ...faster, evictionsPerSecond: null }, 1);
  assert.equal(unknown.enabled, true);
  assert.equal(unknown.reason, 'Measured benefit within configured budgets');
  const measured = policy.observe(reference, { ...faster, evictionsPerSecond: 1 }, 2);
  assert.equal(measured.enabled, false);
  assert.equal(measured.reason, 'Circuit breaker: thrashing');
});

test('zero reference durations cannot make added work beneficial', () => {
  const zero = timed(0);
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
  const atRatio = reference.cpuMs * config.disableRatio;
  assert.equal(policy.observe(reference, faster, 1).enabled, true);
  assert.equal(policy.observe(reference, { ...faster, cpuMs: atRatio }, 2).enabled, true);
  assert.equal(policy.observe(reference, { ...faster, cpuMs: atRatio + 0.01 }, 3).enabled, false);
});
