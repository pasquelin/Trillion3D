import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'

/** The kit's device and an encoder of its own, with a surface whose views stay stable, as a real
 *  surface keeps: a composition is keyed by the flags view it reads. */
export function gpuHarness() {
  const gpu = fakeDevice()
  const view = () => ({}) as GPUTextureView
  /** The view uniform: the buffer the lighting names so (`createDeferredView`). */
  const viewBuffer = () =>
    gpu.buffers.find((buffer) => buffer.label === 'Trillion3D deferred view v1')
  const surfaceViews = [view(), view(), view(), view()],
    surface = {
      views: () => surfaceViews,
      stores: () => [surfaceViews[0], surfaceViews[3]],
      subsurfaceView: view(),
      lobesView: view(),
    } as unknown as SurfaceBuffer
  return {
    ...gpu,
    encoder: gpu.device.createCommandEncoder(),
    view,
    surface,
    /** Each view uniform write, as the floats it sent. */
    get viewWrites() {
      const view: object | undefined = viewBuffer()
      return gpu.writes
        .filter((write) => 'buffer' in write && write.buffer === view)
        .map((write) => written(write) as Float32Array)
    },
    /** Whether the view uniform was destroyed. */
    get viewDestroyed() {
      return gpu.destroyed.includes(viewBuffer()!)
    },
  }
}
