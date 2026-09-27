// #26: a held frame leaves temporal accumulation where the last encoded frame left it.
//
// A barrier (`flush` → `settlePose`) re-renders the pose with convergence images that replay the
// last ordinary image's checkpoint (`../../taa/frame.ts`), into the colour target a hold then shows
// and a capture reads. Held frames used to enter the accumulation anyway: each one took a new
// checkpoint and counted one more still frame, so the replay weighed its image 1/(16 + held frames)
// and the capture depended on how many frames the page had held before the barrier — which run
// order and machine load decide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts';
import { createTaaFrameState } from '../../taa/frame.ts';
import { TAA_STILL_FRAMES } from '../../taa/jitter.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { settledRt } from './hold.fixture.ts';

installGpuGlobals();

/** A settled runtime with temporal accumulation on, the hold armed by two identical frames. */
function heldRuntime(stillFrames: number) {
  const rt = settledRt();
  let checkpoints = 0;
  const frame = createTaaFrameState();
  frame.stillFrames = stillFrames;
  Object.assign(rt.gpu, {
    temporalWanted: true,
    targetSize: [64, 32],
    temporal: { frame, checkpoint: () => checkpoints++, replay: () => true },
  });
  Object.assign(rt.run, { diagnostic: 'beauty', textureConverging: false });
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  return { rt, frame, checkpoints: () => checkpoints };
}

test('#26: a held frame takes no checkpoint and counts no still frame', () => {
  const { rt, frame, checkpoints } = heldRuntime(TAA_STILL_FRAMES - 1);
  const { device } = fakeDevice();
  const sample = frame.sample;
  for (let i = 0; i < 5; i++) assert.equal(holdWebgpuFrame(rt, device), true);
  assert.equal(rt.run.frameHeld, true);
  assert.equal(checkpoints(), 0, 'the checkpoint a barrier replays stays the last encoded one');
  assert.equal(frame.stillFrames, TAA_STILL_FRAMES - 1, 'the replay weighs its image as before');
  assert.equal(frame.sample, sample);
});

test('#26: the quiet frame that still accumulates enters, then the next one is held', () => {
  const { rt, frame, checkpoints } = heldRuntime(TAA_STILL_FRAMES - 2);
  const { device } = fakeDevice();
  assert.equal(holdWebgpuFrame(rt, device), false, 'one frame short of the cycle: drawn');
  assert.equal(checkpoints(), 1);
  assert.equal(frame.stillFrames, TAA_STILL_FRAMES - 1);
  assert.equal(holdWebgpuFrame(rt, device), true, 'the cycle is closed: held');
  assert.equal(checkpoints(), 1);
});
