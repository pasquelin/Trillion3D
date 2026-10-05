// The resolve is a function of its images and jitter ranks alone: the uniform the image entry and
// the pass write is the same word for word whatever the wall clock did between images — the
// flicker measure's rates are counted in images (`shadingHistoryWgsl.ts`), never timed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { beginTaaFrame } from './frame.ts';
import { createTaaFrameState } from './frameState.ts';
import { writeTaaView } from './view.ts';
import { createScaleControl } from '../frame/scaleControl.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';

/** The uniforms of twenty images, moving then still, their frames `intervals` ms apart. */
function uniforms(intervals: number[]) {
  const frame = createTaaFrameState(),
    temporal = { frame, checkpoint() {}, replay: () => false },
    size = () => [64, 32];
  const rt = {
    gpu: { temporal, temporalWanted: true },
    vis: {},
    run: { diagnostic: 'beauty', frame: 0, gate: {} },
    capture: { capturing: false },
  } as unknown as WebgpuPagesRuntime;
  Object.assign(rt.gpu, { targetSize: size(), allocatedSize: size(), displaySize: size() });
  Object.assign(rt, { scale: createScaleControl(undefined) });
  const { device, writes } = fakeDevice(),
    cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera,
    clock = { currentTime: 1000 },
    saved = globalThis.document;
  Object.assign(globalThis, { document: { timeline: clock } });
  try {
    for (let image = 0; image < 20; image++) {
      clock.currentTime += intervals[image % intervals.length];
      beginTaaFrame(rt, cam, image >= 8);
      writeTaaView(device, {} as GPUBuffer, frame, cam, [64, 32], [64, 32], false);
      frame.hasHistory = true;
      frame.sample = (frame.sample + 1) % frame.phases;
      frame.stochasticSample++;
    }
  } finally {
    Object.assign(globalThis, { document: saved });
  }
  return writes.map(({ data }) => [...(data as Float32Array)]);
}

test('two runs of the same images write the same uniform, however long their frames', () => {
  const steady = uniforms([1000 / 120]);
  assert.deepEqual(uniforms([7, 31, 12, 95, 8.3]), steady, 'a hiccuping frame rate');
  assert.deepEqual(uniforms([1000 / 30]), steady, 'thirty images a second');
});
