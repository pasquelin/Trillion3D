// #1344: a shadow page drawn on a still image restarts the still average, else the shadow drawn
// at rest stays diluted in the average, faint. The virtual shadow maps count the pages they drew
// (`renderedTotal`, read back a few frames late, `vsmSettle.ts`): each new count is a landing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { restartTaaOnShadowLanding } from './landing.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

test('pages the shadow maps drew restart the still average, once each', () => {
  const frame = { active: true, stillFrames: 0, hasHistory: true, shadowsSeen: 0 },
    settle = { renderedTotal: 4 },
    rt = {
      gpu: { temporal: { frame } },
      lights: { vsm: { settle } },
    } as never as WebgpuPagesRuntime;
  const land = () => restartTaaOnShadowLanding(rt);
  const still = (frames: number) => Object.assign(frame, { stillFrames: frames, hasHistory: true });
  land();
  still(5);
  land();
  assert.equal(frame.stillFrames, 5, 'nothing landed: the average goes on');
  settle.renderedTotal = 6;
  land();
  assert.deepEqual([frame.stillFrames, frame.hasHistory], [0, false], 'two pages landed');
  still(3);
  land();
  assert.equal(frame.stillFrames, 3, 'each landing restarts it once');
});

test('a session without shadow maps lands nothing', () => {
  const frame = { active: true, stillFrames: 4, hasHistory: true, shadowsSeen: 0 },
    rt = { gpu: { temporal: { frame } }, lights: {} } as never as WebgpuPagesRuntime;
  restartTaaOnShadowLanding(rt);
  assert.equal(frame.stillFrames, 4);
});
