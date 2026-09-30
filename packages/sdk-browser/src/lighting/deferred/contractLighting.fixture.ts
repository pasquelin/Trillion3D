import { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** A deferred lighting on a fake device with its contract program compiled, and an encoder that
 *  records the label of every pass it begins. */
export async function contractLighting() {
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
  const labels: Array<string | undefined> = [];
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      labels.push(descriptor.label);
      return { setPipeline() {}, setBindGroup() {}, setViewport() {}, draw() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = { views: () => views } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView;
  const bind = (contract = true) =>
    lighting.bind(surface, view, view, contract, { lights: {} as GPUBuffer });
  bind();
  await lighting.settle();
  bind();
  return { lighting, labels, encoder, view, bind };
}
