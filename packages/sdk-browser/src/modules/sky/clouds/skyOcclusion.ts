import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import type { Size } from './reconstructLayout.ts'
import { CLOUD_SHADOW_FORMAT, CLOUD_SHADOW_GROUP_SIZE } from './shadowLayout.ts'
import {
  SKY_OCCLUSION_FILTER_BINDING as F,
  SKY_OCCLUSION_FILTER_ENTRY,
  SKY_OCCLUSION_FILTER_PROGRAM,
} from './skyOcclusionWgsl.ts'

/**
 * THE CLOUDS' SKY OCCLUSION MAP, DECLARED: its hemisphere filter, its layout and pipeline, and the
 * size of its dispatches. The trace is the cloud shadow map's own program and layouts
 * (`createCloudShadowPasses` of `./shadow.ts`), not made again here. Nothing is wired into a
 * frame; the pass's owner makes two textures of `side` texels a side (format
 * `CLOUD_SHADOW_FORMAT`, usage `TRACED_USAGE` of `reconstructLayout.ts`, the second also sampled),
 * writes the blocks (`writeSkyOcclusionTrace`, `writeSkyOcclusionFilter`) with the frame of
 * `cloudSkyOcclusionFrame`, and dispatches the shadow trace into the first texture, then, when
 * `cloudSkyAOFiltering` is on, the filter from the first into the second. The map the air
 * reads is the second, else the first. It is made only where `cloudSkyOcclusionWanted`.
 */

/** The groups to dispatch for a map of `size` texels: one thread to a texel. */
export const skyOcclusionDispatch = (size: Size) => ({
  x: workgroupCount(size.width, CLOUD_SHADOW_GROUP_SIZE),
  y: workgroupCount(size.height, CLOUD_SHADOW_GROUP_SIZE),
  z: 1,
})

/** The filter's group: the map it reads and the sampler that reads it bilinearly, its block, the
 *  map it writes. */
export const skyOcclusionFilterEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(F.source, 'float'),
  computeSamplerEntry(F.sampler),
  computeUniformEntry(F.block),
  computeStorageTextureEntry(F.destination, CLOUD_SHADOW_FORMAT),
]

/** The filter's layout and pipeline, asked now, off the frame; `failed` hears a failure to
 *  compile. */
export function createSkyOcclusionPasses(device: GPUDevice, failed: (error: unknown) => void) {
  const filter = device.createBindGroupLayout({ entries: skyOcclusionFilterEntries() })
  const pipeline = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [filter] }),
    device.createShaderModule({
      label: 'Trillion3D cloud sky occlusion filter',
      code: SKY_OCCLUSION_FILTER_PROGRAM,
    }),
    SKY_OCCLUSION_FILTER_ENTRY,
    undefined,
    'Trillion3D cloud sky occlusion filter',
  ).ask()
  pipeline.prepare().catch(failed)
  return { filter, filtering: pipeline }
}
