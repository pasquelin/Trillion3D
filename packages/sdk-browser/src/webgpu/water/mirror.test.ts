// #1279: the water composite's mirror ray is bounded — the Hi-Z walk, a miss on the filtered
// probes (`BOUNDED_SCREEN_REFLECTION_WGSL`) —, the fluids' own quality tier; a reference session
// (`reflectionTrace`, `frame/referenceMode.ts`) compiles the whole walk on its first image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { functionText } from '../../bounce/wgslBody.fixture.ts';
import { createWaterCompositeLayout, createWaterComposites } from './pipelines.ts';
import { waterCompositeShader } from './compositeWgsl.ts';
import { waterRoutedShader } from './routedWgsl.ts';

installGpuGlobals();

test('the water mirror walks the depth bounds, but in a reference session, chosen at creation', async () => {
  const ray = (shader: string) => functionText(shader, 'resolvedReflectionRay');
  assert.match(ray(waterCompositeShader()), /return boundedReflectionRay\(P,N,R\);/);
  assert.match(ray(waterRoutedShader()), /return boundedReflectionRay\(P,N,R\);/);
  for (const shader of [waterCompositeShader(true), waterRoutedShader(true)])
    assert.match(ray(shader), /screenReflection\(P,R\)[^]*reflectedRadiance\(/);
  // The fake device hands each descriptor back as its pipeline.
  const label = (pipeline: GPURenderPipeline) =>
    ((pipeline as unknown as GPURenderPipelineDescriptor).fragment!.module as { label: string })
      .label;
  for (const unbounded of [false, true]) {
    const { device, renderPipelines } = fakeDevice();
    const layout = createWaterCompositeLayout(device);
    const composites = await createWaterComposites(device, layout, unbounded);
    const suffix = unbounded ? '_UNBOUNDED' : '';
    assert.equal(label(composites.at(false, false)), `WATER_COMPOSITE${suffix}`);
    assert.equal(label(composites.at(false, true)), `WATER_COMPOSITE${suffix}`);
    assert.equal(label(composites.at(true, false)), `WATER_ROUTED${suffix}`);
    const made = renderPipelines.length;
    composites.at(false, true);
    assert.equal(renderPipelines.length, made, 'each pipeline is made once');
  }
});
