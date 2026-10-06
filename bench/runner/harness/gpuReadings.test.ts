import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuReadings } from './gpuReadings.ts';

const render = (frame: number, gpuFrameMs: number | null, gpuIdleMs: number | null) => ({
  gpuPassMs: { frame, totalMs: null, passes: [], truncated: false },
  gpuFrameMs,
  gpuIdleMs,
});

test('one GPU time and one idle per sampled image, the idle only where one was measured', () => {
  const gpu = gpuReadings();
  gpu.push({ gpuFrameMs: null });
  gpu.push(render(4, 6, null));
  // Renders between two samples carry the same sample: counted once.
  gpu.push(render(4, 6, null));
  gpu.push(render(5, 7, 1.5));
  assert.deepEqual(gpu.gpuFrameMs, [6, 7]);
  assert.deepEqual(gpu.gpuIdleMs, [1.5]);
});
