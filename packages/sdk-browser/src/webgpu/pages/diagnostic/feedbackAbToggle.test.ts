import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginTaaFrame } from '../../../taa/frame.ts';
import { createTaaFrameState } from '../../../taa/frameState.ts';
import { createScaleControl } from '../../../frame/scaleControl.ts';
import { keepWebgpuFrame } from '../../frame/hold.ts';
import { setFeedbackTargetAb } from './feedbackAb.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';

test('same-device toggle changes only feedback allocation and selected pipelines', async () => {
  installGpuGlobals();
  let destroyed = 0,
    created = 0;
  const made: GPUExtent3D[] = [];
  const destroy = () => void destroyed++;
  const on = { shadeClasses: { name: 'on' }, blendPipelines: {} };
  const off = { shadeClasses: { name: 'off' }, blendPipelines: {} };
  const device = {
    queue: { onSubmittedWorkDone: async () => {} },
    createTexture: ({ size }: GPUTextureDescriptor) => {
      created++;
      made.push(size);
      return { createView: () => ({ name: 'feedback' }), destroy };
    },
  };
  const main = {};
  const rt = {
    context: { feedbackTargetAB: true },
    feedbackAB: { target: true, force: false, on, off },
    gpu: {
      device,
      hdrTexture: {},
      // The target is the others' size, the one they were made at, below which an image draws.
      targetSize: [10, 5],
      allocatedSize: [20, 10],
      targetBytes: 20_000,
      feedbackTexture: { destroy },
      feedbackView: {},
    },
    vis: {
      writesFeedback: true,
      textures: {
        metrics: () => ({
          textureTilesPending: 0,
          textureMissingLevels: 0,
          textureTilesRequested: 2,
          textureTilesAtLevel: 2,
        }),
        settled: async () => {},
      },
    },
    blendState: {},
    views: { active: main, main },
    capture: { capturing: false },
    run: { frameHeld: true },
  } as unknown as WebgpuPagesRuntime;
  await setFeedbackTargetAb(rt, false);
  assert.equal(destroyed, 1);
  assert.equal(rt.gpu.feedbackTexture, undefined);
  assert.equal(rt.gpu.targetBytes, 20_000 - 20 * 10 * 4);
  assert.equal(rt.vis.shadeClasses, off.shadeClasses);
  assert.equal(rt.vis.blendPipelines, off.blendPipelines);
  assert.equal(rt.feedbackAB?.force, true);
  await setFeedbackTargetAb(rt, true);
  assert.equal(created, 1);
  assert.deepEqual(made, [{ width: 20, height: 10 }], 'at the size of the targets beside it');
  assert.equal(rt.gpu.targetBytes, 20_000);
  assert.equal(rt.vis.shadeClasses, on.shadeClasses);
  assert.equal(rt.vis.blendPipelines, on.blendPipelines);
});

test('forced full renders replay settled TAA and never replace the held checkpoint', () => {
  let replayed = 0,
    kept = 0;
  const frame = createTaaFrameState();
  const rt = {
    feedbackAB: { force: true },
    gpu: {
      temporalWanted: true,
      targetSize: [20, 10],
      allocatedSize: [20, 10],
      displaySize: [20, 10],
      temporal: {
        frame,
        replay: () => ++replayed > 0,
      },
    },
    capture: { capturing: false },
    vis: {},
    scale: createScaleControl(undefined),
    run: {
      diagnostic: 'beauty',
      textureConverging: false,
      gate: {
        hold: { keep: () => void kept++ },
      },
    },
  } as unknown as WebgpuPagesRuntime;
  const camera = {
    viewProjection: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  } as Parameters<typeof beginTaaFrame>[1];
  beginTaaFrame(rt, camera, true);
  keepWebgpuFrame(rt);
  assert.equal(replayed, 1);
  assert.equal(frame.active, true);
  assert.equal(kept, 0);
});
