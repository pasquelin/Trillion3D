import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { inertTaaDevice } from './device.fixture.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';

// A convergence frame replays the last ordinary frame: every field the checkpoint keeps comes
// back, the sampled rank among them, so it draws the same lights and makes the same image.
test('the checkpoint keeps the frame fields the replay restores, sampled rank included', async () => {
  const temporal = await createTemporalAntialiasing(inertTaaDevice(), []);
  const { frame } = temporal;
  Object.assign(frame, {
    sample: 3,
    stochasticSample: 27,
    stillFrames: 0,
    hasHistory: true,
    sceneSeen: 7,
    sampledRank: 42,
  });
  frame.previousViewProjection.fill(0.5);
  temporal.checkpoint(false);
  Object.assign(frame, {
    sample: 4,
    stochasticSample: 28,
    stillFrames: 1,
    hasHistory: false,
    sceneSeen: 8,
    sampledRank: 0,
  });
  frame.previousViewProjection.fill(0);
  assert.equal(temporal.replay(), false, 'the replayed stillness is the checkpointed one');
  assert.deepEqual(
    [
      frame.sample,
      frame.stochasticSample,
      frame.stillFrames,
      frame.hasHistory,
      frame.sceneSeen,
      frame.sampledRank,
    ],
    [3, 27, 0, true, 7, 42],
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
    [...renderPipelines[0].fragment!.targets].map((target) => target!.format),
    ['rgba16float', 'rgba8unorm', 'rg32uint', 'r32uint'],
  );
  temporal.resize(8, 4);
  // First the 1×1 zero a frame without reactive value reads, then the two histories.
  assert.deepEqual(
    textures.map(({ format }) => format),
    [
      'rg8unorm',
      'rg32uint',
      'r32uint',
      'rgba16float',
      'rgba8unorm',
      'rg32uint',
      'r32uint',
      'rgba16float',
      'rgba8unorm',
    ],
  );
  assert.equal(temporal.historyBytes, 8 * 4 * (2 * 8 + 2 * 4 + 2 * 8 + 2 * 4));
  temporal.dispose();
});

test('filtered histories fit portable attachment bytes and release every guide with their targets', async () => {
  // Every resolve draws, its filtered twin into the most targets.
  const { device, textures, destroyed, renderPipelines } = fakeDevice();
  const temporal = await createTemporalAntialiasing(device, []);
  temporal.resize(8, 4);
  const view = () => ({}) as GPUTextureView,
    buffer = {} as GPUBuffer,
    pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
  const encoder = { beginRenderPass: () => pass } as unknown as GPUCommandEncoder;
  const inputs = { current: view(), depth: view(), ids: view(), pages: buffer, motion: buffer };
  const frame = { ...inputs, pool: buffer, positions: buffer, uvs: buffer };
  temporal.encode(encoder, { ...frame, filter: [view(), view()] });
  const filtered = () =>
    renderPipelines.filter(({ fragment }) => fragment!.module.label?.endsWith('_FILTERED'));
  while (!filtered().length) await new Promise((done) => setImmediate(done));
  const bytes = new Map<string, number>([
    ['rgba16float', 8],
    ['rgba8unorm', 4],
    ['rg32uint', 8],
    ['r32uint', 4],
  ]);
  for (const pipeline of renderPipelines) {
    const targets = [...pipeline.fragment!.targets];
    assert.equal(
      targets.length,
      filtered().includes(pipeline) ? 6 : 4,
      'the colour, share, geometry and flicker, and for a filtered one the two layers',
    );
    assert.ok(
      targets.reduce((sum, target) => sum + bytes.get(target!.format)!, 0) <= 32,
      'with the two four-byte display layers, within the portable limit',
    );
  }
  const guides = textures.filter(
    ({ label }) => label?.includes('TAA geometry') || label?.includes('TAA flicker'),
  );
  assert.equal(guides.length, 4);
  temporal.release();
  assert.equal(temporal.historyBytes, 0);
  for (const guide of guides) assert.ok(destroyed.includes(guide));
  temporal.dispose();
});
