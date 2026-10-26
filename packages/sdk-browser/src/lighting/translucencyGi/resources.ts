import { retire } from '../../gpu/core/frameRetire.ts'
import { gpuAllocator } from '../../gpu/core/resourceAllocator.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  TRANSLUCENCY_GI_FORMAT,
  TRANSLUCENCY_GI_FRAME,
  traceExtent,
  volumeExtent,
  type TranslucencyGiGrid,
} from './layout.ts'

/** What a view holds of the volume at the size of a grid: the frame's uniform, the textures of the cones' light (the trace writes one, the
 *  filter's passes take turns between the two) and the two volumes that take turns (the one written is the next image's history). */
export interface GiResources {
  /** What the textures were made for, a key: the grid's cells and the cones a cell side. */
  readonly key: string
  readonly frame: GPUBuffer
  readonly cones: readonly [GPUTextureView, GPUTextureView]
  readonly volumes: readonly [GPUTextureView, GPUTextureView]
  readonly bytes: number
  destroy(): void
}

/** The key of the resources a grid and `tracing` cones a cell side ask for. */
export const resourcesKey = (grid: TranslucencyGiGrid, tracing: number) =>
  `${grid.x}x${grid.y}x${grid.z}|${tracing}`

/** The resources for a grid and `tracing` cones a cell side. */
export function createGiResources(
  device: GPUDevice,
  grid: TranslucencyGiGrid,
  tracing: number,
): GiResources {
  const a = gpuAllocator(device, 'Trillion3D translucency GI')
  const cone = (name: string) =>
    a.texture(name, traceExtent(grid, tracing), TRANSLUCENCY_GI_FORMAT, { dimension: '3d' })
  const volume = (name: string) =>
    a.texture(name, volumeExtent(grid), TRANSLUCENCY_GI_FORMAT, { dimension: '3d' })
  const resources = {
    key: resourcesKey(grid, tracing),
    frame: a.buffer('frame', TRANSLUCENCY_GI_FRAME.words, 'uniform'),
    cones: [cone('cones 0'), cone('cones 1')] as const,
    volumes: [volume('volume 0'), volume('volume 1')] as const,
    bytes: a.bytes(),
    destroy: () => a.destroy(),
  }
  return resources
}

/** The resources given back, destroyed once the image that names them is submitted. */
export const giveBack = (device: GPUDevice, resources: GiResources) =>
  retire(device, { destroy: () => resources.destroy() })

/** The sampler the volume is read through, by the surfaces and by the integration's history: trilinear, the edge held. */
export const giSampler = oncePerDevice((device: GPUDevice) =>
  device.createSampler({
    label: 'Trillion3D translucency GI sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  }),
)
