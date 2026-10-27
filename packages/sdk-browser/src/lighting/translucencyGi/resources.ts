import { retire } from '../../gpu/core/frameRetire.ts'
import { gpuAllocator } from '../../gpu/core/resourceAllocator.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  fogVolumeExtent,
  TRANSLUCENCY_GI_FRAME,
  TRANSLUCENCY_GI_VOLUME_FORMAT,
  traceExtent,
  translucencyGiAmbientFormat,
  volumeExtent,
  type TranslucencyGiGrid,
} from './layout.ts'

/** The volume the surfaces read: the ambient light (the constant band, in the lighting data format) and the directional light (the linear
 *  bands, signed, half floats), two textures of the one grid. */
export interface GiVolume {
  readonly ambient: GPUTextureView
  readonly directional: GPUTextureView
}

/** What a view holds of the volume at the size of a grid: the frame's uniform, the textures of the cones' light (the trace writes one, the
 *  filter's passes take turns between the two), the two volumes that take turns (the one written is the next image's history) and the
 *  fog's volume, this image's light before its history and its intensity. */
export interface GiResources {
  /** What the textures were made for, a key: the grid's cells, the cones a cell side and the cones' format. */
  readonly key: string
  /** The format of the cones' light (`translucencyGiConeFormat`). */
  readonly coneFormat: GPUTextureFormat
  readonly frame: GPUBuffer
  readonly cones: readonly [GPUTextureView, GPUTextureView]
  readonly volumes: readonly [GiVolume, GiVolume]
  readonly fogVolume: GPUTextureView
  readonly bytes: number
  destroy(): void
}

/** The key of the resources a grid and `tracing` cones a cell side of light in the format `coneFormat` ask for. */
export const resourcesKey = (
  grid: TranslucencyGiGrid,
  tracing: number,
  coneFormat: GPUTextureFormat,
) => `${grid.x}x${grid.y}x${grid.z}|${tracing}|${coneFormat}`

/** The resources for a grid and `tracing` cones a cell side, their light in the format `coneFormat`. */
export function createGiResources(
  device: GPUDevice,
  grid: TranslucencyGiGrid,
  tracing: number,
  coneFormat: GPUTextureFormat,
): GiResources {
  const a = gpuAllocator(device, 'Trillion3D translucency GI')
  const cone = (name: string) =>
    a.texture(name, traceExtent(grid, tracing), coneFormat, { dimension: '3d' })
  const ambientFormat = translucencyGiAmbientFormat(coneFormat, device.features)
  const volume = (name: string): GiVolume => ({
    ambient: a.texture(`${name} ambient`, volumeExtent(grid), ambientFormat, { dimension: '3d' }),
    directional: a.texture(
      `${name} directional`,
      volumeExtent(grid),
      TRANSLUCENCY_GI_VOLUME_FORMAT,
      { dimension: '3d' },
    ),
  })
  const resources = {
    key: resourcesKey(grid, tracing, coneFormat),
    coneFormat,
    frame: a.buffer('frame', TRANSLUCENCY_GI_FRAME.words, 'uniform'),
    cones: [cone('cones 0'), cone('cones 1')] as const,
    volumes: [volume('volume 0'), volume('volume 1')] as const,
    fogVolume: a.texture('fog volume', fogVolumeExtent(grid), TRANSLUCENCY_GI_VOLUME_FORMAT, {
      dimension: '3d',
    }),
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
