// The WebGPU effect chain (#349): an empty chain adds no pass, no copy and no target; a chain
// with a bloom makes its targets at the first frame that draws it, keeps them while the size
// holds, counts their bytes, and gives them back when it empties.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { effect } from '../../../sdk-core/src/world/effect/index.ts';
import { bloomBlend, bloomLevelBytes, bloomLevelSizes } from './bloomFilter.ts';
import { createWebgpuEffects } from './webgpuEffects.ts';

/** An encoder that records the passes begun on it, their target and the dynamic offset of
 *  their first bind group. */
function recorder() {
  const passes: { label?: string; load: string; view: unknown; offset?: number }[] = [];
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      const [color] = descriptor.colorAttachments as GPURenderPassColorAttachment[];
      const pass = { label: descriptor.label, load: color.loadOp, view: color.view } as const;
      passes.push(pass);
      const setBindGroup = (index: number, _group: unknown, offsets?: number[]) =>
        void (index || Object.assign(pass, { offset: offsets?.[0] }));
      return { setPipeline() {}, setBindGroup, draw() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  return { encoder, passes };
}

const input = { input: true } as unknown as GPUTextureView;

async function loaded() {
  const gpu = fakeDevice();
  const effects = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)));
  return { gpu, effects };
}

test('an empty chain returns its input and creates, writes and encodes nothing', async () => {
  const { gpu, effects } = await loaded();
  const { encoder, passes } = recorder();
  assert.equal(effects.encode(encoder, [], input, 64, 32), input);
  assert.deepEqual(
    [passes.length, gpu.textures.length, gpu.buffers.length, gpu.writes.length],
    [0, 0, 0, 0],
  );
  assert.equal(gpu.renderPipelines.length, 0, 'not even a program is compiled');
  assert.equal(effects.bytes, 0);
});

test('a bloom compiles once, then draws 2 × levels passes into targets made once per size', async () => {
  const { gpu, effects } = await loaded();
  const bloom = effect.bloom({ intensity: 0.5 });
  const { encoder, passes } = recorder();
  assert.equal(effects.encode(encoder, [bloom], input, 64, 32), input, 'compiling: no chain yet');
  assert.equal(effects.loading, true);
  while (effects.loading) await new Promise((resolve) => setImmediate(resolve));
  const levels = bloomLevelSizes(64, 32).length;
  const output = effects.encode(encoder, [bloom], input, 64, 32);
  assert.notEqual(output, input);
  assert.equal(passes.length, 2 * levels);
  assert.equal(effects.draws, 2 * levels);
  assert.deepEqual(
    passes.map((pass) => pass.load),
    [...Array(levels).fill('clear'), ...Array(levels - 1).fill('load'), 'clear'],
    'down the levels, up adding into each, then the blend',
  );
  assert.equal(passes.at(-1)!.view, output);
  assert.equal(effects.bytes, 64 * 32 * 8 + bloomLevelBytes(64, 32));
  const made = gpu.textures.length,
    writes = gpu.writes.length;
  assert.equal(made, 2, 'one pass target and the level chain');
  effects.encode(encoder, [bloom], input, 64, 32);
  assert.deepEqual(
    [gpu.textures.length, gpu.writes.length],
    [made, writes],
    'nothing remade or rewritten',
  );
  bloom.intensity = 0.25;
  effects.encode(encoder, [bloom], input, 64, 32);
  assert.equal(gpu.writes.length, writes + 1, 'a setting rewrites the uniform once');
  effects.encode(encoder, [bloom], input, 128, 64);
  assert.equal(
    effects.bytes,
    128 * 64 * 8 + bloomLevelBytes(128, 64),
    'the targets follow the size',
  );
  effects.encode(encoder, [], input, 128, 64);
  assert.equal(effects.bytes, 0, 'an emptied chain gives its targets back');
  for (const texture of gpu.textures) assert.ok(gpu.destroyed.includes(texture), texture.label);
});

test('two passes read each other through two targets in turn', async () => {
  const { gpu, effects } = await loaded();
  const { encoder, passes } = recorder();
  const chain = [effect.bloom(), effect.bloom()];
  effects.encode(encoder, chain, input, 64, 32);
  while (effects.loading) await new Promise((resolve) => setImmediate(resolve));
  const output = effects.encode(encoder, chain, input, 64, 32);
  const each = 2 * bloomLevelSizes(64, 32).length;
  assert.equal(gpu.textures.length, 3, 'two pass targets and the level chain');
  assert.equal(passes.length, 2 * each);
  assert.notEqual(passes[each - 1].view, output, 'the first writes one target');
  assert.equal(passes[2 * each - 1].view, output, 'the second the other, which composition reads');
});

test('two blooms draw with their own settings, each from its own uniform range', async () => {
  const { gpu, effects } = await loaded();
  const { encoder, passes } = recorder();
  const chain = [effect.bloom({ intensity: 0.2 }), effect.bloom({ intensity: 0.8, radius: 2 })];
  effects.encode(encoder, chain, input, 64, 32);
  while (effects.loading) await new Promise((resolve) => setImmediate(resolve));
  passes.length = 0;
  effects.encode(encoder, chain, input, 64, 32);
  // The uniform buffer as the queue leaves it before the frame's first pass.
  const uniform = gpu.buffers.find((buffer) => buffer.label === 'Trillion3D bloom uniform')!;
  const floats = new Float32Array(uniform.size / 4);
  for (const write of gpu.writes)
    if (write.buffer === (uniform as unknown)) floats.set(written(write), write.offset / 4);
  const levels = bloomLevelSizes(64, 32).length,
    each = 2 * levels;
  chain.forEach((bloom, n) => {
    const at = passes[(n + 1) * each - 1].offset! / 4,
      { keep, glow } = bloomBlend(bloom.intensity, levels);
    assert.deepEqual(
      [...floats.subarray(at + 4, at + 7)],
      [bloom.radius, keep, glow].map(Math.fround),
      `bloom ${n} blends with its own intensity and radius`,
    );
  });
});
