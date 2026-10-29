import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { reflectionLayout } from '../reflectionPipelines.ts'
import { rayFogLayoutEntries } from '../rayFog.ts'
import { REFLECTION_GRID_FORMAT, REFLECTION_RAY_FORMAT } from '../grids.ts'
import { BLUE_NOISE_FORMAT } from '../../../gpu/noise/blueNoiseTextures.ts'
import { REFLECTION_FOG_BINDINGS, REFLECTION_TRACE_BINDINGS as B } from '../trace/traceBindings.ts'
import { radianceCacheEntries, radianceCacheProgram } from './wgsl.ts'

/** The kernels' group 0: the opaque surface's pixels, its rays (read and written as storage) and tracing tiles, the lights and the blue noise, the fog's cubemap
 *  and the fresh grid the cache's light is written to, then the radiance cache's resources. */
const cacheLayout = (device: GPUDevice, light: LightAtlasFormat) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection radiance cache',
    entries: [
      computeTextureEntry(B.flags, 'uint'),
      computeTextureEntry(B.normals, 'unfilterable-float'),
      computeTextureEntry(B.lobes, 'uint'),
      computeStorageTextureEntry(B.rays, REFLECTION_RAY_FORMAT, 'read-write', '2d-array'),
      computeBufferEntry(B.tiles, 'read-only-storage'),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeStorageTextureEntry(B.blue, BLUE_NOISE_FORMAT, 'read-only'),
      ...rayFogLayoutEntries(REFLECTION_FOG_BINDINGS, true),
      computeStorageTextureEntry(B.traceOut, REFLECTION_GRID_FORMAT),
      ...radianceCacheEntries(light),
    ],
  })

const ENTRIES = ['cacheLimits', 'cacheReads'] as const

/**
 * The radiance cache's kernels of the reflections (`wgsl.ts`) for the opaque surface, made once for the device and the format `light` the cache's final maps are
 * stored in, compiled off the frame and not waited for: until they are `ready` the rays go their whole length.
 */
export const radianceCacheKernels = oncePerDeviceKey(
  (device: GPUDevice, light: LightAtlasFormat) => {
    const layout = cacheLayout(device, light)
    const stages = startedComputeStages(
      device,
      'Trillion3D reflection radiance cache',
      device.createPipelineLayout({ bindGroupLayouts: [layout, reflectionLayout(device)] }),
      device.createShaderModule({
        label: 'Trillion3D reflection radiance cache',
        code: radianceCacheProgram(light),
      }),
      ENTRIES,
      { REFLECTION_LAYER: 0 },
    )
    return {
      layout,
      get ready() {
        return stages.ready
      },
      pipeline: (entry: (typeof ENTRIES)[number]) => stages.pipelineOf(entry),
    }
  },
)
