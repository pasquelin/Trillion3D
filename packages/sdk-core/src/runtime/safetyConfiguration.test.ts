import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafetyPolicy, type SafetyConfig } from './safety.ts';

const config: SafetyConfig = {
  minimumSamples: 1,
  minimumPeriodMs: 0,
  disableRatio: 1.2,
  enableRatio: 0.8,
  consecutiveViolations: 1,
};

test('safety policy refuses each invalid bound independently', () => {
  for (const [field, values] of Object.entries({
    minimumSamples: [0, -1, 1.5, NaN, Infinity],
    consecutiveViolations: [0, -1, 1.5, NaN, Infinity],
    minimumPeriodMs: [-1, NaN, Infinity],
    enableRatio: [0, -0.1, NaN, Infinity, 1.2, 1.3],
    disableRatio: [NaN, Infinity, 0.8, 0.7],
  }))
    for (const value of values)
      assert.throws(
        () => createSafetyPolicy({ ...config, [field]: value }),
        /INVALID_SAFETY_POLICY/,
        `${field}: ${value}`,
      );
  assert.doesNotThrow(() => createSafetyPolicy(config));
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
  for (const [i, reason] of [
    'error',
    'oom',
    'device-lost',
    'thrashing',
    'quality-failed',
  ].entries()) {
    const decision = policy.trip(reason as Parameters<typeof policy.trip>[0], i + 1);
    assert.deepEqual(decision, {
      tier: 'baseline',
      enabled: false,
      reason: `Circuit breaker: ${reason}`,
      changedAt: i + 1,
      revision: i + 1,
    });
    assert.equal(policy.getDecision(), decision);
    assert.equal(policy.trip(reason as Parameters<typeof policy.trip>[0], i + 1), decision);
  }
});

test('circuit breakers reject nonfinite and backwards clocks but accept an unchanged clock', () => {
  const policy = createSafetyPolicy(config);
  const first = policy.trip('error', 10);
  assert.equal(policy.trip('error', 10), first);
  for (const time of [9, NaN, Infinity, -Infinity])
    assert.throws(() => policy.trip('oom', time), /INVALID_CLOCK/);
});
