import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { inertTaaDevice } from './device.fixture.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { TAA_BINDINGS } from './bindingsWgsl.ts';

// A convergence frame replays the last ordinary frame: every field the checkpoint keeps comes
// back, the sampled rank among them, so it draws the same lights and makes the same image.
test('the checkpoint keeps the frame fields the replay restores, sampled rank included', async () => {
  const temporal = await createTemporalAntialiasing(inertTaaDevice(), []);
  const { frame } = temporal;
  Object.assign(frame, {
    sample: 3,
    stillFrames: 0,
    hasHistory: true,
    sceneSeen: 7,
    sampledRank: 42,
  });
  frame.previousViewProjection.fill(0.5);
  temporal.checkpoint(false);
  Object.assign(frame, {
    sample: 4,
    stillFrames: 1,
    hasHistory: false,
    sceneSeen: 8,
    sampledRank: 0,
  });
  frame.previousViewProjection.fill(0);
  assert.equal(temporal.replay(), false, 'the replayed stillness is the checkpointed one');
  assert.deepEqual(
    [frame.sample, frame.stillFrames, frame.hasHistory, frame.sceneSeen, frame.sampledRank],
    [3, 0, true, 7, 42],
  );
  assert.ok(frame.previousViewProjection.every((value) => value === 0.5));
  temporal.dispose();
});

// Each history carries its colour and, beside it, the as-is share composition reads (#365) and the
// placement tags (#833): the pass writes both targets, and the bytes it declares count both.
test('each history is a colour and its as-is share, written together and counted', async () => {
  const { device, textures, renderPipelines } = fakeDevice();
  const temporal = await createTemporalAntialiasing(device, []);
  assert.deepEqual(
    [...renderPipelines.at(-1)!.fragment!.targets].map((target) => target!.format),
    ['rgba16float', 'rgba8unorm'],
  );
  temporal.resize(8, 4);
  // First the 1×1 zero a frame without reactive value reads, then the two histories.
  assert.deepEqual(
    textures.map(({ format }) => format),
    ['rg8unorm', 'rgba16float', 'rgba8unorm', 'rgba16float', 'rgba8unorm'],
  );
  assert.equal(temporal.historyBytes, 8 * 4 * (2 * 8 + 2 * 4));
  temporal.dispose();
});

// OMB-11: both resolves compile with the pass; a frame handed no flags draws the flagless one, on
// a group and layout without the flags nor the share history, and compiles nothing.
test('a frame with no as-is pixel resolves flagless, and switching compiles no pipeline', async () => {
  const { device, renderPipelines } = fakeDevice();
  const temporal = await createTemporalAntialiasing(device, []);
  const modules = renderPipelines.map((pipeline) => pipeline.fragment!.module.label);
  assert.deepEqual(modules, ['TAA_RESOLVE', 'TAA_RESOLVE_FLAGLESS', 'TAA_RESOLVE_BLENDED']);
  temporal.resize(8, 4);
  const drawn: Array<{ module?: string; bindings: number[]; layout: number[] }> = [];
  const pass = {
    setPipeline: (pipeline: GPURenderPipelineDescriptor) =>
      void drawn.push({ module: pipeline.fragment!.module.label, bindings: [], layout: [] }),
    setBindGroup(_slot: number, group: GPUBindGroupDescriptor) {
      const last = drawn[drawn.length - 1];
      last.bindings = [...group.entries].map((entry) => entry.binding);
      const { entries } = group.layout as unknown as GPUBindGroupLayoutDescriptor;
      last.layout = [...entries].map((entry) => entry.binding);
    },
    draw() {},
    end() {},
  };
  const encoder = { beginRenderPass: () => pass } as unknown as GPUCommandEncoder;
  const view = () => ({}) as GPUTextureView,
    buffer = {} as GPUBuffer;
  const inputs = {
    current: view(),
    depth: view(),
    ids: view(),
    pages: buffer,
    motion: buffer,
    pool: buffer,
    positions: buffer,
    uvs: buffer,
  };
  temporal.encode(encoder, inputs);
  temporal.encode(encoder, { ...inputs, flags: view() });
  temporal.encode(encoder, { ...inputs, share: view() });
  assert.equal(renderPipelines.length, 3, 'no pipeline compiled in a frame');
  const share = [TAA_BINDINGS.flags, TAA_BINDINGS.shareHistory];
  assert.equal(drawn[0].module, 'TAA_RESOLVE_FLAGLESS');
  for (const binding of share) {
    assert.ok(!drawn[0].bindings.includes(binding), 'the flagless group binds no share');
    assert.ok(!drawn[0].layout.includes(binding), 'nor does its layout declare one');
  }
  assert.equal(drawn[1].module, 'TAA_RESOLVE');
  assert.ok(share.every((binding) => drawn[1].bindings.includes(binding)));
  assert.equal(drawn[2].module, 'TAA_RESOLVE_BLENDED');
  assert.ok(share.every((binding) => drawn[2].bindings.includes(binding)));
  temporal.dispose();
});
