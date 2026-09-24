import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBlendPipelines } from '../blend/pipelines.ts';
import { drawBlendPass } from '../blend/draw.ts';
import { encodeWaterPass } from './pass.ts';
import { device, mountDevice, prepared, replay, targets } from './pass.fixture.ts';
import type { BlendGpuItem } from '../blend/state.ts';

const items = (count: number, transmissive: boolean, blending = 'normal') =>
  Array.from({ length: count }, () => ({ transmissive, surface: { blending } }) as BlendGpuItem);

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
  assert.equal(built.blendPipelines.built.length, 3, 'the three blends are kept');
});

test('without the pass, the transmission slice draws as one more blend', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const { rt, encoder, passes, counters } = replay(blendState, gpu);
  // What `encodeBlend` does after the blends: the pass, or the slice as a blend.
  const composed = encodeWaterPass(rt, encoder);
  if (blendState.transmissive && !composed) drawBlendPass(rt, device, encoder, true);
  assert.equal(composed, false);
  assert.equal(counters.copies, 0, 'no backdrop copy without the pass');
  assert.deepEqual(
    passes,
    [{ label: 'Trillion3D transmission', drawn: [1] }],
    'the slice, as a blend',
  );
  assert.equal(rt.run.blendDrawCalls, 1);
});

// #346: a mode a blend item declares compiles its three pipelines, beside the normal ones.
test('the blend pipelines are built for normal and for every mode a blend item declares', async () => {
  const glow = mountDevice();
  const built = await createWebgpuBlendPipelines(glow.device, items(2, false, 'additive'));
  assert.equal(glow.pipelines.length, 6, 'normal and additive, three culls each');
  assert.equal(built.blendPipelines.built.length, 6);
  assert.ok(built.blendPipelines.built.every(Boolean), 'additive sits right after normal');
});

// #346: a blending written on a surface after the pass was built is compiled by the first draw
// that asks for it, once, and never drawn as another mode.
test('a mode first drawn after the pass was built compiles its three pipelines then', async () => {
  const plain = mountDevice();
  const built = await createWebgpuBlendPipelines(plain.device, items(2, false));
  assert.equal(plain.pipelines.length, 3, 'a plain scene compiles the three normal pipelines');
  const multiplyBack = 3 * 3 + 2;
  const pipeline = built.blendPipelines.at(multiplyBack);
  assert.ok(pipeline, 'the multiply back-face pipeline is drawn');
  assert.equal(plain.pipelines.length, 6, 'multiply compiled its three culls, nothing else');
  assert.equal(built.blendPipelines.at(multiplyBack), pipeline, 'compiled once');
  assert.equal(plain.pipelines.length, 6);
  assert.throws(() => built.blendPipelines.at(15), /names no blending mode/);
});
