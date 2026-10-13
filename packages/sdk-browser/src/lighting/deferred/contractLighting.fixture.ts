import { createDeferredLighting } from './deferred.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** The kit's device and an encoder of its own, with a surface whose views stay stable, as a real
 *  surface keeps: a composition is keyed by the flags view it reads. */
export function gpuHarness() {
  const gpu = fakeDevice()
  const view = () => ({}) as GPUTextureView
  const surfaceViews = [view(), view(), view(), view()],
    surface = { views: () => surfaceViews } as unknown as SurfaceBuffer
  return {
    ...gpu,
    encoder: gpu.device.createCommandEncoder(),
    view,
    surface,
    /** Each view uniform write, as the floats it sent. */
    get viewWrites() {
      return gpu.writes.map((write) => written(write) as Float32Array)
    },
    /** Whether the view uniform, the first buffer made, was destroyed. */
    get viewDestroyed() {
      return gpu.destroyed.includes(gpu.buffers[0]!)
    },
  }
}

/** A deferred lighting on the harness with its contract program compiled, bound to `target`;
 *  `bind(contract)` rebinds it to the direct contract or to the plain composition. */
export async function contractLighting() {
  const h = gpuHarness()
  const lighting = await createDeferredLighting(h.device)
  const target = h.view()
  const bind = (contract = true) =>
    lighting.bind(h.surface, target, target, contract, { lights: {} as GPUBuffer })
  bind()
  await lighting.settle()
  bind()
  return Object.assign(h, { lighting, target, bind })
}
