// #1344: a shadow page the GPU draws itself lands on a still image as a host page does: the still
// average restarts on it, else the shadow drawn at rest stays diluted in the average, faint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { restartTaaOnShadowLanding } from './frame.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

test('pages the GPU drew itself restart the still average, once each', () => {
  const frame = { active: true, stillFrames: 0, hasHistory: true },
    gpu = { drawn: 4 },
    lights = { shadowPagesTotal: 0, shadowEpochSeen: 0, plan: { gpu } },
    rt = { gpu: { temporal: { frame } }, lights } as never as WebgpuPagesRuntime;
  const land = () => restartTaaOnShadowLanding(rt);
  const still = (frames: number) => Object.assign(frame, { stillFrames: frames, hasHistory: true });
  land();
  still(5);
  land();
  assert.equal(frame.stillFrames, 5, 'nothing landed: the average goes on');
  gpu.drawn = 6;
  land();
  assert.deepEqual([frame.stillFrames, frame.hasHistory], [0, false], 'two GPU pages landed');
  still(3);
  land();
  assert.equal(frame.stillFrames, 3, 'each landing restarts it once');
  lights.shadowPagesTotal++;
  land();
  assert.equal(frame.stillFrames, 0, 'a host page restarts it as before');
  // A reseeded pool counts its listings from zero: what it shows is new.
  still(2);
  gpu.drawn = 0;
  land();
  assert.equal(frame.stillFrames, 0, 'a reseed restarts it');
  still(2);
  gpu.drawn = 1;
  land();
  assert.equal(frame.stillFrames, 0, 'a page listed after the reseed lands');
});
