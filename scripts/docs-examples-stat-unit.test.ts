import assert from 'node:assert/strict';
import test from 'node:test';
import { statLines, watchStats } from '../site/examples/kit/statsLines.ts';
import { cpuUnit, engineSteps, unitLines } from '../site/examples/kit/statUnit.ts';

test('the stats corner shows where the frame went, CPU frame, its costliest steps and GPU passes, as stat unit', () => {
  const sample = {
    fps: 30,
    held: false,
    sceneTriangles: null,
    cpu: { frameMs: 1.86, steps: [['encode rest', 1.35] as [string, number]] },
    gpuPassMs: {
      passes: [
        { name: 'shadow-raster', gpuMs: 70, ownMs: 61.2 },
        { name: 'lighting', gpuMs: 9, ownMs: 8.5 },
        { name: 'idle', gpuMs: 0, ownMs: 0 },
        { name: 'taa', gpuMs: 3.1 },
      ],
    },
  };
  assert.deepEqual(unitLines(sample), [
    ['CPU frame', '1.86 ms'],
    ['CPU encode rest', '1.35 ms'],
    ['GPU shadow-raster', '61.20 ms'],
    ['GPU lighting', '8.50 ms'],
    ['GPU taa', '3.10 ms'],
  ]);
  assert.deepEqual(statLines(sample).slice(1, 3), [
    ['CPU frame', '1.86 ms'],
    ['CPU encode rest', '1.35 ms'],
  ]);
  // Nothing measured, nothing shown.
  assert.deepEqual(unitLines({}), []);
});

test('the CPU side of a window is each step median over its frames, the frame and its sums apart', () => {
  const unit = cpuUnit([
    { cpuFrameMs: 2, cpuSubmitMs: 1.9, cpuShadowPlanMs: 0.2, cpuEncodeRestMs: 1.4, drawCalls: 5 },
    { cpuFrameMs: 9, cpuSubmitMs: 8.8, cpuShadowPlanMs: 0.3, cpuEncodeRestMs: 1.2 },
    { cpuFrameMs: 3, cpuShadowPlanMs: null, cpuEncodeRestMs: 1.3, cpuSelectMs: 0 },
  ]);
  assert.equal(unit.frameMs, 3);
  assert.deepEqual(unit.steps, [
    ['encode rest', 1.3],
    ['shadow plan', 0.3],
  ]);
  assert.deepEqual(cpuUnit([]), { frameMs: null, steps: [] });
});

test('the stats corner keeps no frame for the CPU lines when told not to', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let hook: (frame: { metrics: Record<string, number> }) => void = () => {};
  const shown: [string, string][][] = [];
  const stop = watchStats(
    { onFrame: (h) => void (hook = h), scene: {} },
    (lines) => shown.push(lines),
    () => [],
    false,
  );
  hook({ metrics: { cpuFrameMs: 4, gpuFrameMs: 1 } });
  t.mock.timers.tick(500);
  assert.ok(!shown.at(-1)?.some(([label]) => label.startsWith('CPU')));
  stop();
  const on: [string, string][][] = [];
  const again = watchStats({ onFrame: (h) => void (hook = h), scene: {} }, (lines) =>
    on.push(lines),
  );
  hook({ metrics: { cpuFrameMs: 4, gpuFrameMs: 1 } });
  t.mock.timers.tick(500);
  assert.ok(on.at(-1)?.some(([label, value]) => label === 'CPU frame' && value === '4.00 ms'));
  again();
});

test('the engine step window ranks the steps by p95, shows each at its median, and opens again', () => {
  let resets = 0;
  const step = (p50: number, p95: number) => ({ p50, p95 });
  const world = {
    onFrame: () => () => {},
    cpuSteps: () => ({
      steps: { totalMs: step(2, 3), encodeRestMs: step(1.35, 1.68), shadowPassesMs: step(0.33, 2) },
    }),
    resetCpuSteps: () => void resets++,
  };
  assert.deepEqual(engineSteps(world), [
    ['shadow passes', 0.33],
    ['encode rest', 1.35],
  ]);
  assert.equal(resets, 1);
  assert.equal(engineSteps({ onFrame: () => () => {} }), null);
});
