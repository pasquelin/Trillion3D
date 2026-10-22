import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import {
  COMPUTE,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { cloudMaterialLayoutEntries } from './materialWgsl.ts'
import type { Size } from './reconstructLayout.ts'
import {
  CLOUD_SHADOW_BINDING as B,
  CLOUD_SHADOW_FORMAT,
  CLOUD_SHADOW_GROUP_SIZE,
  CLOUD_SHADOW_TEMPORAL_BINDING as T,
} from './shadowLayout.ts'
import {
  CLOUD_SHADOW_AIR,
  CLOUD_SHADOW_FILTER_BINDING as F,
  CLOUD_SHADOW_FILTER_ENTRY,
  CLOUD_SHADOW_FILTER_PROGRAM,
  CLOUD_SHADOW_TEMPORAL_ENTRY,
  CLOUD_SHADOW_TEMPORAL_PROGRAM,
  CLOUD_SHADOW_TRACE_ENTRY,
  CLOUD_SHADOW_TRACE_PROGRAM,
} from './shadowWgsl.ts'

/**
 * THE CLOUD SHADOW MAP, DECLARED: its trace and its spatial filter, their bind group layouts and
 * pipelines, and the size of their dispatches. Nothing here is wired into a frame; the pass's
 * owner makes the textures of `cloudShadowSizes` (format `CLOUD_SHADOW_FORMAT`, usage
 * `TRACED_USAGE` of `reconstructLayout.ts`: written by a compute pass, read by the next), the
 * groups and the dispatches, once for each of the air's two lights that casts a map
 * (`cloudShadowWanted`): the trace into the first texture, then one filter pass into each of the
 * next.
 *
 * Group 0 of the trace is the air's (`CLOUD_SHADOW_AIR`), made by the atmosphere's one way to a
 * group; group 1 holds the cloud material's block, textures and sampler (seven bindings from
 * `B.material`), the trace's block (`writeCloudShadowTrace`) and the map written. The filter's
 * one group holds the map it reads and the map it writes.
 *
 * The temporal filter (`shadowHistory.ts`) is a third pass, run between the trace and the spatial
 * filter when `planCloudShadowTemporal` says `filtered`: its group holds its block
 * (`writeCloudShadowTemporal`), the traced map, the map of the image before (read bilinearly,
 * through `RECONSTRUCT_SAMPLER`, the linear clamped sampler), and the whole map it writes, which
 * the view keeps for the next image. The spatial filter then reads that map.
 */
function cloudShadowTraceEntries(): GPUBindGroupLayoutEntry[] {
  return [
    ...cloudMaterialLayoutEntries(B.material),
    computeUniformEntry(B.block),
    computeStorageTextureEntry(B.output, CLOUD_SHADOW_FORMAT),
  ]
}

/** The filter's group: the map it reads, the map it writes. */
const cloudShadowFilterEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(F.source, 'unfilterable-float'),
  computeStorageTextureEntry(F.destination, CLOUD_SHADOW_FORMAT),
]

/** The temporal filter's group: its block, the traced map, the previous map, the map written, the
 *  sampler. */
const cloudShadowTemporalEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(T.block),
  computeTextureEntry(T.current, 'unfilterable-float'),
  computeTextureEntry(T.previous, 'float'),
  computeStorageTextureEntry(T.destination, CLOUD_SHADOW_FORMAT),
  computeSamplerEntry(T.sampler),
]

/** The groups to dispatch for a map of `size` texels: one thread to a texel. */
export const cloudShadowDispatch = (size: Size) => ({
  x: workgroupCount(size.width, CLOUD_SHADOW_GROUP_SIZE),
  y: workgroupCount(size.height, CLOUD_SHADOW_GROUP_SIZE),
  z: 1,
})

/** The passes' layouts and pipelines, asked now, off the frame; `failed` hears a failure to
 *  compile. The caller releases nothing: a pipeline and its layouts are the device's. */
export function createCloudShadowPasses(device: GPUDevice, failed: (error: unknown) => void) {
  const air = device.createBindGroupLayout({ entries: airLayoutEntries(CLOUD_SHADOW_AIR, COMPUTE) })
  const cloud = device.createBindGroupLayout({ entries: cloudShadowTraceEntries() })
  const filter = device.createBindGroupLayout({ entries: cloudShadowFilterEntries() })
  const temporal = device.createBindGroupLayout({ entries: cloudShadowTemporalEntries() })
  const stage = (layouts: GPUBindGroupLayout[], code: string, entry: string, label: string) =>
    askedComputeStage(device, layouts, code, entry, label, failed)
  return {
    air,
    cloud,
    filter,
    temporal,
    trace: stage(
      [air, cloud],
      CLOUD_SHADOW_TRACE_PROGRAM.code,
      CLOUD_SHADOW_TRACE_ENTRY,
      'Trillion3D cloud shadow trace',
    ),
    filtering: stage(
      [filter],
      CLOUD_SHADOW_FILTER_PROGRAM,
      CLOUD_SHADOW_FILTER_ENTRY,
      'Trillion3D cloud shadow filter',
    ),
    blending: stage(
      [temporal],
      CLOUD_SHADOW_TEMPORAL_PROGRAM,
      CLOUD_SHADOW_TEMPORAL_ENTRY,
      'Trillion3D cloud shadow temporal filter',
    ),
  }
}
