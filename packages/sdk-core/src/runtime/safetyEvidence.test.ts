import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeEvidence } from './safetyEvidence.ts';
import type { MeasuredCosts, SafetyConfig } from './safety.ts';
import { config, faster, reference, timed } from './safety.fixture.ts';

const judge = (left: MeasuredCosts, right: MeasuredCosts, budgets: Partial<SafetyConfig> = {}) =>
  judgeEvidence(left, right, { ...config, ...budgets });
const beneficial = { harmful: false, beneficial: true };
const neutral = { harmful: false, beneficial: false };
const harmful = { harmful: true, beneficial: false };

test('a single incomparable field in either measurement vetoes the feature', () => {
  for (const patch of [
    { contextKey: 'other' },
    { provenance: 'estimated' },
    ...['cpuMs', 'gpuMs', 'latencyMs', 'memoryBytes', 'evictionsPerSecond'].flatMap((field) =>
      [-1, NaN, Infinity].map((value) => ({ [field]: value })),
    ),
  ]) {
    const veto = { veto: 'Incomparable or invalid evidence' };
    assert.deepEqual(judge({ ...reference, ...patch } as MeasuredCosts, faster), veto);
    assert.deepEqual(judge(reference, { ...faster, ...patch } as MeasuredCosts), veto);
  }
});

test('GPU and memory requirements distinguish unmeasured from zero', () => {
  const gpu = { requireGpuTiming: true };
  const noGpu = { veto: 'GPU evidence unavailable' };
  assert.deepEqual(judge({ ...reference, gpuMs: null }, faster, gpu), noGpu);
  assert.deepEqual(judge(reference, { ...faster, gpuMs: null }, gpu), noGpu);
  assert.deepEqual(judge(reference, { ...faster, gpuMs: 0 }, gpu), beneficial);
  assert.deepEqual(judge(reference, { ...faster, memoryBytes: null }, { memoryBudgetBytes: 20 }), {
    veto: 'Memory evidence unavailable',
  });
  assert.deepEqual(judge(reference, { ...faster, memoryBytes: null, gpuMs: null }), beneficial);
});

test('memory and eviction limits are inclusive and veto only above the budget', () => {
  for (const [field, option, reason] of [
    ['memoryBytes', 'memoryBudgetBytes', 'Circuit breaker: memory budget'],
    ['evictionsPerSecond', 'maxEvictionsPerSecond', 'Circuit breaker: thrashing'],
  ]) {
    const budget = { [option]: 20 };
    assert.deepEqual(judge(reference, { ...faster, [field]: 20 }, budget), beneficial);
    assert.deepEqual(judge(reference, { ...faster, [field]: 21 }, budget), { veto: reason });
    assert.deepEqual(judge(reference, { ...faster, [field]: 1000 }), beneficial, 'no ceiling');
  }
});

test('an unmeasured eviction rate never fabricates thrashing, even under a zero ceiling', () => {
  const none = { maxEvictionsPerSecond: 0 };
  assert.deepEqual(judge(reference, { ...faster, evictionsPerSecond: null }, none), beneficial);
  assert.deepEqual(judge(reference, { ...faster, evictionsPerSecond: 1 }, none), {
    veto: 'Circuit breaker: thrashing',
  });
});

test('zero reference durations cannot make added work beneficial', () => {
  const zero = timed(0);
  assert.deepEqual(judge(zero, zero, { enableRatio: 1 }), beneficial);
  assert.deepEqual(judge(zero, { ...zero, cpuMs: 1 }, { enableRatio: 1 }), harmful);
});

test('each cost channel can veto a benefit or make the candidate harmful', () => {
  for (const field of ['cpuMs', 'gpuMs', 'latencyMs']) {
    assert.deepEqual(judge(reference, { ...faster, [field]: 9 }), neutral, field);
    assert.deepEqual(judge(reference, { ...faster, [field]: 13 }), harmful, field);
  }
});

test('optional GPU measurements are compared only when both sides have a duration', () => {
  for (const [left, right] of [
    [null, null],
    [null, 0],
    [null, 5],
    [0, null],
    [10, null],
  ])
    assert.deepEqual(judge({ ...reference, gpuMs: left }, { ...faster, gpuMs: right }), beneficial);
});

test('the ratio bounds are inclusive: exactly at a ratio still counts as within it', () => {
  const atDisable = reference.cpuMs * config.disableRatio;
  assert.deepEqual(judge(reference, { ...faster, cpuMs: atDisable }), neutral);
  assert.deepEqual(judge(reference, { ...faster, cpuMs: atDisable + 0.01 }), harmful);
  const atEnable = timed(reference.cpuMs * config.enableRatio);
  assert.deepEqual(judge(reference, atEnable), beneficial);
  assert.deepEqual(judge(reference, { ...atEnable, cpuMs: atEnable.cpuMs + 0.01 }), neutral);
});
