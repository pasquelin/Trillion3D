import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafetyPolicy, type MeasuredCosts } from './index.ts';
const value = (cpuMs: number): MeasuredCosts => ({
  contextKey: 'same-scene-camera-materials-resolution',
  provenance: 'measured',
  cpuMs,
  gpuMs: null,
  latencyMs: cpuMs,
  memoryBytes: 10,
  evictionsPerSecond: 0,
});
const config = {
  minimumSamples: 2,
  minimumPeriodMs: 100,
  disableRatio: 1.1,
  enableRatio: 0.9,
  consecutiveViolations: 2,
  memoryBudgetBytes: 20,
};
test('Optimization requires comparable evidence, uses hysteresis, and trips immediately on errors', () => {
  const p = createSafetyPolicy(config);
  assert.equal(p.observe(value(10), value(8), 100).enabled, false);
  assert.equal(p.observe(value(10), value(8), 110).enabled, true);
  assert.equal(p.observe(value(10), value(12), 120).enabled, true);
  assert.equal(p.observe(value(10), value(12), 130).enabled, true);
  assert.equal(p.observe(value(10), value(12), 220).enabled, false);
  assert.equal(p.observe(value(10), value(8), 230).enabled, false);
  assert.equal(p.observe(value(10), value(8), 330).enabled, true);
  assert.equal(p.trip('device-lost', 331).enabled, false);
});
test('Missing/incomparable evidence and memory pressure cannot enable optimization', () => {
  const p = createSafetyPolicy(config);
  assert.equal(p.observe(value(10), { ...value(8), contextKey: 'different' }, 100).enabled, false);
  assert.equal(p.observe(value(10), { ...value(8), memoryBytes: 30 }, 200).enabled, false);
  assert.match(p.getDecision().reason, /memory budget/);
});
test('WebGL probing matches production attributes, loses the probe context, and does not touch WebGPU', async () => {
  const { detectCapabilities } = await import('../sdk-browser/index.ts');
  let gpuCalls = 0,
    hostCalls = 0,
    probeCalls = 0,
    lost = 0;
  const host = {
    getContext: () => {
      hostCalls++;
      throw new Error('host canvas was bound');
    },
  };
  const probe = {
    getContext: (kind: string, attributes?: WebGLContextAttributes) => {
      probeCalls++;
      assert.equal(kind, 'webgl2');
      assert.equal(attributes?.alpha, false);
      assert.equal(attributes?.antialias, false);
      return {
        getSupportedExtensions: () => ['EXT_test'],
        getExtension: (name: string) => {
          assert.equal(name, 'WEBGL_lose_context');
          return {
            loseContext() {
              lost++;
            },
          };
        },
      };
    },
  };
  const environment = {
    get gpu(): GPU {
      gpuCalls++;
      throw new Error('WebGPU touched');
    },
    createWebglCanvas: () => probe as unknown as HTMLCanvasElement,
  };
  const result = await detectCapabilities(
    'webgl',
    host as unknown as HTMLCanvasElement,
    environment,
  );
  assert.equal(result.renderer, 'webgl2');
  assert.equal(hostCalls, 0);
  assert.equal(probeCalls, 1);
  assert.equal(lost, 1);
  assert.equal(gpuCalls, 0);
  await detectCapabilities('webgl', host as unknown as HTMLCanvasElement, environment);
  assert.equal(probeCalls, 2);
});
test('Recovered fallback has no user notice; only unrecoverable failure is actionable', async () => {
  const { userNotice } = await import('./index.ts');
  assert.equal(
    userNotice({
      eventVersion: 1,
      type: 'fallback',
      audience: 'diagnostic',
      recovered: true,
      code: 'OOM',
      detail: 'Backend and thresholds',
    }),
    null,
  );
  assert.deepEqual(
    userNotice({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'NO_RENDERER',
    }),
    { messageKey: 'scene-unavailable', action: 'retry' },
  );
});
