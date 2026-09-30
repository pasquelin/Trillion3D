// #1346: once nothing changes, the world stops drawing within 20 frames at any render scale — the
// TAA still average (`taaStillFrames`) and the rough reflection's still window
// (`REFLECTION_STILL_FRAMES`) both close, and the hold takes over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts';
import { createTaaFrameState } from '../../taa/frameState.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { settledRt } from './hold.fixture.ts';
import { createReflectionHistory } from '../../reflections/historyRuntime.ts';
import type { ReflectionHistoryFrame } from '../../reflections/historyFrame.ts';
import { resolveHistory, stillHistoryFrame } from '../../reflections/historyFrame.fixture.ts';

installGpuGlobals();

const REST_FRAMES = 20;
const DISPLAY = [64, 32];

/** Frames drawn, the changed one included, once `change` is made to a still world's reflection
 *  drawn at `scale` of the display, before the hold takes over. */
function framesToRest(change: (frame: ReflectionHistoryFrame) => void, scale: number) {
  const gpu = fakeDevice();
  const rt = settledRt();
  const taa = createTaaFrameState();
  const drawn = DISPLAY.map((side) => side * scale);
  Object.assign(rt.gpu, {
    temporalWanted: true,
    targetSize: [...drawn],
    allocatedSize: [...drawn],
    displaySize: [...DISPLAY],
    temporal: { frame: taa, checkpoint() {}, replay: () => true },
    deferred: { usesContract: true },
  });
  Object.assign(rt.run, { diagnostic: 'beauty', textureConverging: false });
  // No shadow lands: a page lands only once drawn (`reflections/frame.test.ts`).
  Object.assign(rt.lights, { shadowPagesTotal: 0 });
  const history = createReflectionHistory(gpu.device, drawn[0], drawn[1], {
    depth: {} as GPUTextureView,
    ids: {} as GPUTextureView,
  });
  rt.gpu.reflection = { active: true, history } as unknown as NonNullable<typeof rt.gpu.reflection>;
  const current = gpu.device.createTexture({ size: drawn, format: 'rgba16float', usage: 1 });
  const frame = stillHistoryFrame(current, 0);
  const draw = () => {
    frame.frame = ++rt.run.frame;
    resolveHistory(gpu.device, history, frame, current, drawn);
    keepWebgpuFrame(rt);
  };
  // A long-settled world first, then the change on the first still image.
  for (let i = 0; i < 200 && !holdWebgpuFrame(rt, gpu.device); i++) draw();
  assert.equal(history.settled, true, 'the world rested before the change');
  // The changed image is drawn, a moving one: the still average restarts after it.
  change(frame);
  taa.stillFrames = 0;
  draw();
  assert.equal(history.settled, false, 'the change reopened the reflection window');
  let frames = 1;
  try {
    for (; frames <= 100 && !holdWebgpuFrame(rt, gpu.device); frames++) draw();
  } finally {
    history.dispose();
  }
  return frames;
}

for (const scale of [1, 0.75, 0.5])
  for (const [name, change] of [
    ['a relit reflection', (frame: ReflectionHistoryFrame) => frame.lighting[0]++],
    [
      'a moved source the motion cannot follow',
      (frame: ReflectionHistoryFrame) => frame.epoch[0]++,
    ],
  ] as const)
    test(`#1346: ${name} rests within 20 frames at render scale ${scale}`, () => {
      const frames = framesToRest(change, scale);
      assert.ok(frames <= REST_FRAMES, `${frames} frames drawn`);
    });
