import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafetyPolicy, type SafetyConfig } from './safety.ts';
import { config, faster, reference, timed } from './safety.fixture.ts';

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

test('evidence that vetoes the feature turns it off at once, with the reason it gives', () => {
  const policy = createSafetyPolicy(config);
  assert.equal(policy.observe(reference, faster, 1).enabled, true);
  const off = policy.observe(reference, { ...faster, contextKey: 'other' }, 2);
  assert.deepEqual(off, {
    tier: 'baseline',
    enabled: false,
    reason: 'Incomparable or invalid evidence',
    changedAt: 2,
    revision: 2,
  });
});
