// #26 (shadow-pool write side): the hardware clips a sun caster against the near and far planes
// and mints corners between the snapped ones, whose f32 sum with the pool's origin rounds
// differently at every origin the pool places the page at. Depth clipping off clamps z instead:
// no near/far corner is minted, so a page rasterizes alike in every slot and the sun's A/A is 0 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowDepthDraws } from './depthDraws.ts';

/** A device offering `features`, recording every render pipeline it is asked to build. */
function deviceOffering(features: string[]) {
  const descriptors: GPURenderPipelineDescriptor[] = [];
  const device = {
    features: new Set(features),
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      descriptors.push(descriptor);
      return {} as GPURenderPipeline;
    },
  } as unknown as GPUDevice;
  return { device, descriptors };
}

const MODULE = {} as GPUShaderModule,
  LAYOUT = {} as GPUPipelineLayout;

test('the pool depth draws clamp depth, never clip, on a device with depth-clip-control', () => {
  const { device, descriptors } = deviceOffering(['depth-clip-control']);
  shadowDepthDraws(device, MODULE, LAYOUT).made();
  assert.equal(descriptors.length, 3, 'the opaque, envelope and cutout draws');
  for (const descriptor of descriptors) assert.equal(descriptor.primitive?.unclippedDepth, true);
});

test('without the feature the draws keep the default, clipping', () => {
  const { device, descriptors } = deviceOffering([]);
  shadowDepthDraws(device, MODULE, LAYOUT).made();
  for (const descriptor of descriptors)
    assert.equal(descriptor.primitive?.unclippedDepth, undefined);
});
