// The deferred lighting's frames, drawn on the kit's device: the program each draw is lit with.
import { createDeferredLighting } from './deferred.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** The frames of `lighting`, made on `gpu`, each lit with `direct`, and the label of each program
 *  `gpu` drew with. */
export function recorder(
  gpu: ReturnType<typeof fakeDevice>,
  lighting: Awaited<ReturnType<typeof createDeferredLighting>>,
) {
  const encoder = gpu.device.createCommandEncoder()
  const labels = () => gpu.draws.map(({ pipeline }) => pipeline.fragment?.module.label)
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = { views: () => views } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView
  const draw = (direct: {
    narrow?: boolean
    unshadowed?: boolean
    rectless?: boolean
    lobeless?: boolean
  }) => {
    lighting.bind(surface, view, view, true, { lights: {} as GPUBuffer, ...direct })
    if (lighting.usesContract) lighting.light(encoder, view)
    return lighting.usesContract
  }
  return { labels, draw }
}

/** A lighting on a kit device whose image wears no lobe: lit by the lobeless program, drawn twice
 *  — before and after its programs settled. */
export async function lobelessLighting() {
  const gpu = fakeDevice(),
    { device } = gpu
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(gpu, lighting)
  draw({ lobeless: true })
  await lighting.settle()
  draw({ lobeless: true })
  return { gpu, device, lighting, labels, draw }
}
