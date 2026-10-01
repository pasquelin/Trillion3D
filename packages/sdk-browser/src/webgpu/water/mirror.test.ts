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

test('the water mirror walks the depth bounds, but in a reference session', async () => {
  const ray = (shader: string) => functionText(shader, 'resolvedReflectionRay');
  assert.match(ray(waterCompositeShader()), /screenReflectionHiZ\(P,R\)/);
  assert.match(ray(waterRoutedShader()), /screenReflectionHiZ\(P,R\)/);
  for (const shader of [waterCompositeShader(undefined, true), waterRoutedShader(undefined, true)])
    assert.match(ray(shader), /screenReflection\(P,R\)[^]*reflectedRadiance\(/);
  const { device, renderPipelines } = fakeDevice();
  const composites = await createWaterComposites(device, createWaterCompositeLayout(device));
  // The fake device hands each descriptor back as its pipeline.
  const label = (pipeline: GPURenderPipeline) =>
    ((pipeline as unknown as GPURenderPipelineDescriptor).fragment!.module as { label: string })
      .label;
  assert.equal(label(composites.at(false, false)), 'WATER_COMPOSITE');
  assert.equal(label(composites.at(false, true, true)), 'WATER_COMPOSITE_UNBOUNDED');
  assert.equal(label(composites.at(true, false, true)), 'WATER_ROUTED_UNBOUNDED');
  assert.equal(label(composites.at(true, false)), 'WATER_ROUTED');
  const made = renderPipelines.length;
  composites.at(false, true, true);
  assert.equal(renderPipelines.length, made, 'each pipeline is made once');
});
