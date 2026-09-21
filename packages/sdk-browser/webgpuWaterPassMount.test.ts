import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { encodeWaterPass, waterPassRefusal } from './webgpuWaterPass.ts';
import { WATER_MAX_ITEMS } from './webgpuWaterSurfaceWgsl.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { device, prepared, replay, targets } from './webgpuWaterPassFixture.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

installGpuGlobals();

/** A device that builds every pipeline and layout as a plain record, and counts the pipelines. */
function mountDevice() {
  const pipelines: string[] = [];
  return {
    pipelines,
    device: {
      createBindGroupLayout: (descriptor: unknown) => descriptor,
      createPipelineLayout: () => ({}),
      createRenderPipeline: (descriptor: { fragment: { entryPoint: string } }) => {
        pipelines.push(descriptor.fragment.entryPoint);
        return {};
      },
      createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
      createBuffer: () => ({}),
    } as unknown as GPUDevice,
  };
}
const items = (count: number, transmissive: boolean) =>
  Array.from({ length: count }, () => ({ transmissive }) as BlendGpuItem);

test('the water pass is mounted with the blend pipelines only for a scene that transmits', async () => {
  const opaque = mountDevice();
  const none = await createWebgpuBlendPipelines(opaque.device, items(3, false));
  assert.equal(none.water, undefined, 'no transmissive item, no pass');
  assert.deepEqual(opaque.pipelines, ['fs', 'fs', 'fs'], 'the three blend pipelines only');
  const water = mountDevice();
  const some = await createWebgpuBlendPipelines(water.device, items(3, true));
  assert.ok(some.water, 'a transmissive item mounts the pass');
  assert.deepEqual(
    water.pipelines,
    ['fs', 'fs', 'fs', 'fsWater', 'fsWater', 'fsWater', 'composeWater'],
    'the surface stage at the three cull modes, then the composite',
  );
});

test('a scene beyond the rank the surface carries keeps its blends and is refused by name', async () => {
  const count = WATER_MAX_ITEMS + 1;
  const refusal = waterPassRefusal(count);
  assert.match(String(refusal), /WATER_ITEMS_LIMIT/, 'the refusal carries its name');
  assert.equal(waterPassRefusal(WATER_MAX_ITEMS), undefined, 'the limit itself is allowed');
  const mount = mountDevice();
  const built = await createWebgpuBlendPipelines(mount.device, items(count, true));
  assert.equal(built.water, undefined, 'no water pass');
  assert.ok(
    built.pipelineBlendTextured,
    'the blend pipelines are kept: the slice draws as a blend',
  );
  assert.deepEqual(mount.pipelines, ['fs', 'fs', 'fs']);
  assert.match(String(built.waterRefused), /WATER_ITEMS_LIMIT/, 'and the caller reads the reason');
});

test('a device that refuses the water pipelines keeps the blends, and the refusal is named', async () => {
  const mount = mountDevice();
  const create = mount.device.createRenderPipeline;
  mount.device.createRenderPipeline = (descriptor: GPURenderPipelineDescriptor) => {
    if (descriptor.fragment?.entryPoint === 'fsWater') throw new Error('DEVICE_SAYS_NO');
    return create(descriptor);
  };
  const built = await createWebgpuBlendPipelines(mount.device, items(2, true));
  assert.equal(built.water, undefined, 'no water pass');
  assert.match(String(built.waterRefused), /DEVICE_SAYS_NO/, 'the device error is what is named');
  assert.ok(built.pipelineBlendTextured && built.pipelineBlendBack, 'the three blends are kept');
});

test('without the pass, the transmission slice draws as one more blend', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const { rt, encoder, passes, counters } = replay(blendState, gpu);
  // What `encodeBlend` does after the blends: the pass, or the slice as a blend.
  const composed = encodeWaterPass(rt, device, encoder, new Float64Array(16));
  if (blendState.transmissive && !composed) drawBlendPass(rt, device, encoder, true);
  assert.equal(composed, false);
  assert.equal(counters.copies, 0, 'no backdrop copy without the pass');
  assert.deepEqual(passes, [{ label: 'WG transmission', drawn: [1] }], 'the slice, as a blend');
  assert.equal(rt.run.blendDrawCalls, 1);
});
