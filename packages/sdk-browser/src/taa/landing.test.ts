// #1344: a shadow page the GPU draws itself lands on a still image as a host page does: the still
// average restarts on it, else the shadow drawn at rest stays diluted in the average, faint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuShadowPagesLanded, restartTaaOnLanding } from './frame.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

test('pages the GPU drew itself restart the still average, once each', () => {
  const frame = { active: true, stillFrames: 0, hasHistory: true },
    gpu = { drawn: 4 },
    rt = { gpu: { temporal: { frame } }, lights: { plan: { gpu } } } as never as WebgpuPagesRuntime;
  const still = (frames: number) => Object.assign(frame, { stillFrames: frames, hasHistory: true });
  restartTaaOnLanding(rt, gpuShadowPagesLanded(rt));
  still(5);
  restartTaaOnLanding(rt, gpuShadowPagesLanded(rt));
  assert.equal(frame.stillFrames, 5, 'nothing landed: the average goes on');
  gpu.drawn = 6;
  restartTaaOnLanding(rt, gpuShadowPagesLanded(rt));
  assert.deepEqual([frame.stillFrames, frame.hasHistory], [0, false], 'two GPU pages landed');
  still(3);
  restartTaaOnLanding(rt, gpuShadowPagesLanded(rt));
  assert.equal(frame.stillFrames, 3, 'each landing restarts it once');
  restartTaaOnLanding(rt, 1 + gpuShadowPagesLanded(rt));
  assert.equal(frame.stillFrames, 0, 'a host page restarts it as before');
});
