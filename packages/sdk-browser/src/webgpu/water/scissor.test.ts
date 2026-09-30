import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaterPass, encodeWaterPass } from './pass.ts';
import { prepared, replay, targets } from './pass.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { WATER_DEPTH_RESTORE } from './depthRestorePass.ts';
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from './passLabels.ts';

test('cropped color origins, depth restore and scissors survive the next full frame', async () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const fake = fakeDevice();
  blendState.water = await createWaterPass(fake.device, {} as never, {} as never);
  const { rt } = replay(blendState, gpu);
  const copies: unknown[] = [],
    passes: GPURenderPassDescriptor[] = [],
    scissors: number[][] = [];
  const encoder = {
    copyTextureToTexture(a: unknown, b: unknown, size: unknown) {
      copies.push(structuredClone({ a, b, size }));
    },
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      passes.push(descriptor);
      return {
        setScissorRect: (...rect: number[]) => scissors.push(rect),
        setViewport() {},
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        drawIndirect() {},
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  const bounds = blendState.waterBounds;
  bounds.active = true;
  bounds.surface.set([2, 3, 6, 7]);
  bounds.backdrop.set([1, 1, 8, 8]);
  assert.equal(encodeWaterPass(rt, encoder), true);
  assert.deepEqual(copies, [
    {
      a: { texture: {}, origin: { x: 1, y: 1 } },
      b: { texture: {}, origin: { x: 1, y: 1 } },
      size: { width: 7, height: 7 },
    },
  ]);
  assert.deepEqual(
    passes.map((p) => p.label),
    [WATER_DEPTH_RESTORE, WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
  );
  assert.deepEqual(
    scissors,
    Array.from({ length: 3 }, () => [2, 3, 4, 4]),
  );
  assert.equal(passes[0].depthStencilAttachment!.depthLoadOp, 'load');
  const restore = fake.renderPipelines.find((p) => p.fragment?.entryPoint === 'restore_fs')!;
  assert.deepEqual(restore.depthStencil, {
    format: 'depth32float',
    depthCompare: 'always',
    depthWriteEnabled: true,
  });
  assert.equal(
    [...passes[1].colorAttachments][3]!.loadOp,
    'clear',
    'word clear remains full-target',
  );
  copies.length = passes.length = scissors.length = 0;
  bounds.surface.set([0, 0, 8, 8]);
  bounds.backdrop.set([0, 0, 8, 8]);
  encodeWaterPass(rt, encoder);
  assert.equal(copies.length, 2, 'full frame uses the original hardware depth copy');
  assert.deepEqual(
    passes.map((p) => p.label),
    [WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
  );
  assert.deepEqual(scissors, [
    [0, 0, 8, 8],
    [0, 0, 8, 8],
  ]);
  assert.deepEqual(copies[0], {
    a: { texture: {}, origin: { x: 0, y: 0 } },
    b: { texture: {}, origin: { x: 0, y: 0 } },
    size: { width: 8, height: 8 },
  });
  // Bounds opened but left empty by the cull fall back to the full target, never a negative rect.
  copies.length = passes.length = scissors.length = 0;
  bounds.surface.set([8, 8, 0, 0]);
  bounds.backdrop.set([8, 8, 0, 0]);
  encodeWaterPass(rt, encoder);
  assert.deepEqual(scissors, [
    [0, 0, 8, 8],
    [0, 0, 8, 8],
  ]);
  assert.equal(copies.length, 2, 'an empty rect takes the whole-target copies');
});
