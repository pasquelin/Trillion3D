// The deferred lighting's frames, drawn on the kit's device: the program each frame is lit with.
import { createDeferredLighting } from './deferred.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pipelinesSettled } from './compileLedger.ts'

/** The frames of `lighting`, made on `gpu`, each lit with `direct`, and the label of the program each
 *  frame was lit with: the name its sun pass's draw of plain surfaces carries, less the pass's. */
export function recorder(
  gpu: ReturnType<typeof fakeDevice>,
  lighting: Awaited<ReturnType<typeof createDeferredLighting>>,
) {
  const encoder = gpu.device.createCommandEncoder()
  const labels = () =>
    gpu.draws
      .map(({ pipeline }) => (pipeline as { label?: string }).label ?? '')
      .filter((label) => label.endsWith('_SUN_SIMPLE'))
      .map((label) => label.slice(0, -'_SUN_SIMPLE'.length))
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = {
      views: () => views,
      stores: () => [views[0], views[3]],
      subsurfaceView: {} as GPUTextureView,
      lobesView: {} as GPUTextureView,
    } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView
  const draw = (direct: {
    narrow?: boolean
    unshadowed?: boolean
    rectless?: boolean
    lobeless?: boolean
    skyShadowing?: { bent: GPUBuffer; params: GPUBuffer }
    bounceGrid?: GPUBuffer
  }) => {
    lighting.bind(surface, view, view, true, { lights: {} as GPUBuffer, ...direct })
    if (lighting.usesContract) lighting.light(encoder, view)
    return lighting.usesContract
  }
  return { labels, draw }
}

/** A lighting on a kit device whose image wears no lobe: lit by the lobeless program, drawn twice
 *  — before and after its programs settled, the fog pass the lit frame asked included. */
export async function lobelessLighting() {
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  draw({ lobeless: true })
  await lighting.settle()
  draw({ lobeless: true })
  await pipelinesSettled(device)
  return { gpu, device, lighting, labels, draw }
}
