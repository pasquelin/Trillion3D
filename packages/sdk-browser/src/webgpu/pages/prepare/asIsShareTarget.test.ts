// #365: the transparents' as-is share keeps a debug view untouched under a lit transparent. A
// blended scene with no debug view must draw exactly what it drew before that share: no seed pass,
// no r8 target, no share attachment in the transparent pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { seedAsIsShare } from './asIsShareTarget.ts';
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts';
import { drawBlendPass } from '../../blend/draw.ts';
import type { BlendGpuItem } from '../../blend/state.ts';
import { device, mountDevice, prepared, replay, targets } from '../../water/pass.fixture.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A blended image whose targets are made, and an encoder that notes each pass's label. */
function blendedImage() {
  const labels: string[] = [];
  const encoder = {
    beginRenderPass: ({ label }: GPURenderPassDescriptor) => (
      labels.push(label!),
      { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }
    ),
  } as unknown as GPUCommandEncoder;
  const rt = {
    vis: { blendPipelines: {}, asIsShown: false },
    run: { diagnostic: 'beauty' },
    blendState: { blendGpu: [{}] },
    gpu: {
      surfaces: { views: () => [{}, {}, {}, {}] },
      allocatedSize: [8, 4],
      targetBytes: 100,
    },
  } as unknown as WebgpuPagesRuntime;
  const { device: gpuDevice, textures } = fakeDevice();
  return { rt, encoder, labels, gpuDevice, textures };
}

test('a blended scene with no debug view runs no share pass and makes no r8 target', () => {
  const { rt, encoder, labels, gpuDevice, textures } = blendedImage();
  assert.equal(seedAsIsShare(rt, gpuDevice, encoder), undefined);
  assert.deepEqual(labels, [], 'no seed pass');
  assert.equal(textures.length, 0, 'no share target');
  assert.equal(rt.gpu.targetBytes, 100, 'nothing more costed');
  // A debug view shown: the share is made once, costed, and seeded every image.
  rt.vis.asIsShown = true;
  const share = seedAsIsShare(rt, gpuDevice, encoder);
  assert.ok(share);
  assert.equal(seedAsIsShare(rt, gpuDevice, encoder), share, 'kept with the targets');
  assert.deepEqual(
    textures.map(({ format, size }) => [format, size]),
    [['r8unorm', { width: 8, height: 4 }]],
  );
  assert.equal(rt.gpu.targetBytes, 100 + 8 * 4);
  assert.deepEqual(labels, ['Trillion3D as-is share seed', 'Trillion3D as-is share seed']);
});

test('without a debug view the transparent pass binds no share and draws the shareless pipelines', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const { rt, encoder, passes } = replay(blendState, gpu);
  const asked: (boolean | undefined)[] = [];
  rt.vis.blendPipelines = {
    at: (_rank: number, _filtered?: boolean, share?: boolean) => (asked.push(share), {}),
  } as unknown as WebgpuPagesRuntime['vis']['blendPipelines'];
  drawBlendPass(rt, device, encoder);
  assert.equal(passes[0].writes[2], null, 'the share slot stays empty');
  assert.ok(!passes[0].writes.includes(gpu.asIsShare!.view));
  assert.ok(asked.length && asked.every((share) => share === false));
  // A debug view shown: the pass blends into the share, with the pipelines that write it.
  rt.vis.asIsShown = true;
  asked.length = 0;
  drawBlendPass(rt, device, encoder);
  assert.equal(passes[1].writes[2], gpu.asIsShare!.view);
  assert.ok(asked.length && asked.every((share) => share === true));
});

test('the blend pipelines compile the share target only for an image that can show a debug view', async () => {
  const items = [{ transmissive: false, surface: { blending: 'normal' } }] as BlendGpuItem[];
  const plain = mountDevice();
  const built = await createWebgpuBlendPipelines(plain.device, items);
  assert.deepEqual(plain.pipelines, ['fs', 'fs', 'fs']);
  assert.equal(plain.formats('fs')[2], undefined, 'an empty slot, no r8 target');
  built.blendPipelines.at(0, false, true);
  assert.equal(plain.pipelines.length, 6, 'the share set compiles at its first draw');
  const debug = mountDevice();
  await createWebgpuBlendPipelines(debug.device, items, undefined, true, undefined, true);
  assert.equal(debug.formats('fs')[2], 'r8unorm', 'precompiled with the share');
});
