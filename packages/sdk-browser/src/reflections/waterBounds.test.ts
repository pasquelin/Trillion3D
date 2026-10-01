// #1279: the water composite's mirror ray walks the depth bounds within the Hi-Z step cap
// (`BOUNDED_SCREEN_REFLECTION_WGSL`); the reflection targets make them for a transmissive scene and
// build them each image, while a reference session's water walks every pixel and needs none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createScreenReflection, reflectionPlan } from './gpu.ts';
import { physical, sceneOf } from './receivers.fixture.ts';
import { contractLighting } from '../lighting/deferred/contractLighting.fixture.ts';
import { REFLECTION_SOURCE_PASS } from './sourcePass.ts';
import { DEFERRED_LIGHTING_PASS } from '../lighting/deferred/deferred.ts';
import { TEXTURE_MIPS_PASS } from '../texture/mipsPass.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

test('a transmissive scene builds the depth bounds its water mirror walks; a reference one none', async () => {
  const h = await contractLighting();
  for (const reference of [false, true]) {
    // A matte floor and a polished sea: no rough history, no cone, only the water's mirror ray.
    const rt = sceneOf([physical(1)], [physical(0)]);
    rt.blendState.transmissive = 1;
    (rt as { context: Partial<WebgpuPagesRuntime['context']> }).context = {
      unboundedReflections: reference,
    };
    const plan = reflectionPlan(rt);
    assert.deepEqual(
      [plan.active, plan.rough, plan.cone, plan.water, plan.pyramid],
      [true, false, false, !reference, !reference],
    );
    const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } });
    const reflection = createScreenReflection(
      gpu.device,
      64,
      32,
      h.target,
      plan.active,
      plan.rough,
      plan.cone,
      plan.water,
    );
    assert.equal(reflection.water, !reference);
    assert.equal(!!reflection.pyramid, !reference);
    assert.equal(reflection.pyramid?.radiance, reference ? undefined : false);
    h.passes.length = 0;
    h.lighting.light(h.encoder, h.target, reflection);
    const built = h.labels.filter((label) => label === TEXTURE_MIPS_PASS).length;
    assert.equal(built > 0, !reference, 'the bounds are built before the lighting, each image');
    assert.deepEqual(
      h.labels.filter((label) => label !== TEXTURE_MIPS_PASS),
      [REFLECTION_SOURCE_PASS, DEFERRED_LIGHTING_PASS],
    );
    reflection.dispose();
  }
  h.lighting.dispose();
});
