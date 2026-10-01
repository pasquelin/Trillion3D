import assert from 'node:assert/strict';
import test from 'node:test';
import { statLines, unitLines, watchStats } from '../site/examples/kit/statsLines.ts';
import { CPU_STAGES, cpuStages, engineStages } from '../site/examples/kit/statUnit.ts';

test('the stats corner shows where the frame went, CPU frame, each CPU stage and GPU passes, as stat unit', () => {
  const sample = {
    fps: 30,
    held: false,
    sceneTriangles: null,
    cpu: {
      frameMs: 1.86,
      stages: [
        ['cut and culling', 0.4],
        ['command encoding', 1.35],
      ] as [string, number][],
    },
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
    ['CPU cut and culling', '0.40 ms'],
    ['CPU command encoding', '1.35 ms'],
    ['GPU shadow-raster', '61.20 ms'],
    ['GPU lighting', '8.50 ms'],
    ['GPU taa', '3.10 ms'],
  ]);
  assert.deepEqual(statLines(sample).slice(1, 4), unitLines(sample).slice(0, 3));
  // Nothing measured, nothing shown.
  assert.deepEqual(unitLines({}), []);
});

test('each named CPU stage of the engine window is the sum of its steps, in the order of the issue', () => {
  const step = (p50: number) => ({ p50, p95: p50 * 2 });
  const stages = cpuStages({
    steps: {
      totalMs: step(9),
      selectionDispatchMs: step(0.25),
      partitionMs: step(0.5),
      adoptCutMs: { p50: NaN, p95: NaN },
      pendingMs: step(0.1),
      retainMs: step(0.2),
      shadowPlanMs: step(0.3),
      shadowRequestsMs: step(0.1),
      encodeRestMs: step(1.35),
      physicsMs: step(2),
      shadowPassesMs: step(4),
    },
  });
  assert.deepEqual(
    stages?.map(([name]) => name),
    CPU_STAGES.map(([name]) => name),
  );
  const at = (name: string) => stages?.find(([stage]) => stage === name)?.[1];
  assert.equal(at('cut and culling'), 0.75);
  assert.ok(Math.abs(at('page preparation')! - 0.3) < 1e-9);
  assert.equal(at('shadow planning'), 0.4);
  assert.equal(at('command encoding'), 1.35);
  assert.equal(at('physics step'), 2);
  // A stage none of whose steps ran is left out; no step window, no stage.
  assert.deepEqual(cpuStages({ steps: { encodeRestMs: step(1) } }), [['command encoding', 1]]);
  assert.equal(cpuStages(null), null);
});

test('the corner reads each frame of the half second, though the engine hands the same metrics', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let hook: (frame: { metrics: { cpuFrameMs?: number } }) => void = () => {};
  const shown: [string, string][][] = [];
  const stop = watchStats(
    { onFrame: (h) => void (hook = h), scene: {} },
    (lines) => shown.push(lines),
    () => [],
    { open: () => true, stages: () => [['physics step', 1]] },
  );
  const metrics = { cpuFrameMs: 0 };
  // The first read only opens the engine's window again: it spans the time before the corner.
  t.mock.timers.tick(500);
  assert.ok(!shown.at(-1)?.some(([label]) => label === 'CPU physics step'));
  for (const value of [2, 4, 9]) hook({ metrics: Object.assign(metrics, { cpuFrameMs: value }) });
  t.mock.timers.tick(500);
  assert.deepEqual(shown.at(-1)?.slice(1), [
    ['CPU frame', '4.00 ms'],
    ['CPU physics step', '1.00 ms'],
  ]);
  stop();
});

test('with the panel closed, the corner keeps no CPU time and reads no CPU stage', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let hook: (frame: { metrics: Record<string, number> }) => void = () => {};
  let open = false,
    reads = 0;
  const shown: [string, string][][] = [];
  const stop = watchStats(
    { onFrame: (h) => void (hook = h), scene: {} },
    (lines) => shown.push(lines),
    () => [],
    { open: () => open, stages: () => (reads++, [['command encoding', 1]]) },
  );
  hook({ metrics: { cpuFrameMs: 4, gpuFrameMs: 1 } });
  t.mock.timers.tick(500);
  assert.ok(!shown.at(-1)?.some(([label]) => label.startsWith('CPU')));
  assert.equal(reads, 0);
  // Opened, it shows only the frames drawn since.
  open = true;
  hook({ metrics: { cpuFrameMs: 6, gpuFrameMs: 1 } });
  t.mock.timers.tick(500);
  assert.ok(shown.at(-1)?.some(([label, value]) => label === 'CPU frame' && value === '6.00 ms'));
  // The engine's window spans the closed time: read to open it again, not shown.
  assert.ok(!shown.at(-1)?.some(([label]) => label === 'CPU command encoding'));
  assert.equal(reads, 1);
  hook({ metrics: { cpuFrameMs: 6, gpuFrameMs: 1 } });
  t.mock.timers.tick(500);
  assert.ok(shown.at(-1)?.some(([label]) => label === 'CPU command encoding'));
  stop();
});

test('the engine stage window is read once, then opens again; WebGL2 has none', () => {
  let resets = 0;
  const world = {
    onFrame: () => () => {},
    cpuSteps: () => ({ steps: { encodeRestMs: { p50: 1.35, p95: 1.68 } } }),
    resetCpuSteps: () => void resets++,
  };
  assert.deepEqual(engineStages(world), [['command encoding', 1.35]]);
  assert.equal(resets, 1);
  assert.equal(engineStages({ onFrame: () => () => {} }), null);
});
