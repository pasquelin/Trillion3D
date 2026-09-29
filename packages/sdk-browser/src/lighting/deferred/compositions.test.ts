// #963: the composition takes the chain's last bloom blend over. Its programs compile at the first
// frame that asks, off the frame, and a composition handed a blend binds it as group 1 at its
// dynamic offset, with the pipelines that read it; without one, nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('a composition handed a bloom blend reads it through the bloom pipelines (#963)', async () => {
  const { device, renderPipelines } = fakeDevice();
  const passes: { pipeline?: GPURenderPipeline; groups: unknown[][] }[] = [];
  const encoder = {
    beginRenderPass() {
      const pass: (typeof passes)[number] = { groups: [] };
      passes.push(pass);
      return {
        setPipeline: (pipeline: GPURenderPipeline) => void (pass.pipeline = pipeline),
        setBindGroup: (...args: unknown[]) => void pass.groups.push(args),
        draw() {},
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  const view = () => ({}) as GPUTextureView;
  const views = [view(), view(), view(), view()];
  const lighting = await createDeferredLighting(device);
  lighting.bind({ views: () => views } as unknown as SurfaceBuffer, view(), view(), false);
  const compiled = renderPipelines.length,
    failures: unknown[] = [];
  assert.equal(
    lighting.composesBloom((error) => failures.push(error)),
    false,
    'compiling',
  );
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(renderPipelines.length, compiled + 6, 'three inputs, capture and present');
  assert.equal(
    lighting.composesBloom((error) => failures.push(error)),
    true,
  );
  const image = { color: view(), share: view() },
    blend = { group: {} as GPUBindGroup, offset: 11 * 256 };
  lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, { ...image, bloom: blend });
  lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, image);
  const label = (pass: (typeof passes)[number]) =>
    (pass.pipeline as unknown as GPURenderPipelineDescriptor).fragment!.module.label;
  assert.deepEqual(passes.map(label), [
    'UNLIT_COMPOSE_BLOOM_ACCUMULATED',
    'UNLIT_COMPOSE_ACCUMULATED',
  ]);
  assert.deepEqual(passes[0].groups[1], [1, blend.group, [blend.offset]]);
  assert.equal(passes[1].groups.length, 1, 'no blend, no second group');
  assert.equal(passes[0].groups[0][1], passes[1].groups[0][1], 'one group per image read');
  assert.deepEqual(failures, []);
  lighting.dispose();
});
