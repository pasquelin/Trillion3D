import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'

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
