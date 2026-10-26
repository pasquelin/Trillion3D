import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { CLOUD_SHADOW_FORMAT } from './shadowLayout.ts'
import {
  SKY_OCCLUSION_FILTER_BINDING as F,
  SKY_OCCLUSION_FILTER_ENTRY,
  SKY_OCCLUSION_FILTER_PROGRAM,
} from './skyOcclusionWgsl.ts'

/**
 * THE CLOUDS' SKY OCCLUSION MAP, DECLARED: its hemisphere filter, its layout and pipeline; its
 * dispatches are the shadow map's (`cloudShadowDispatch` of `./shadow.ts`). The trace is the cloud
 * shadow map's own program and layouts (`createCloudShadowPasses` of `./shadow.ts`), not made again
 * here. The map's run (`./skyOcclusionRun.ts`) makes two textures of `side` texels a side (format
 * `CLOUD_SHADOW_FORMAT`, written by a compute pass and sampled), writes the blocks
 * (`writeSkyOcclusionTrace`, `writeSkyOcclusionFilter`) with the frame of `cloudSkyOcclusionFrame`,
 * and dispatches the shadow trace into the first texture, then, when `cloudSkyAOFiltering` is on,
 * the filter from the first into the second. The map the air reads is the second, else the first.
 * It is made only where `cloudSkyOcclusionWanted`.
 */

/** The filter's group: the map it reads and the sampler that reads it bilinearly, its block, the
 *  map it writes. */
const skyOcclusionFilterEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(F.source, 'float'),
  computeSamplerEntry(F.sampler),
  computeUniformEntry(F.block),
  computeStorageTextureEntry(F.destination, CLOUD_SHADOW_FORMAT),
]

/** The filter's layout and pipeline, asked now, off the frame; `failed` hears a failure to
 *  compile. */
export function createSkyOcclusionPasses(device: GPUDevice, failed: (error: unknown) => void) {
  const filter = device.createBindGroupLayout({ entries: skyOcclusionFilterEntries() })
  const pipeline = askedComputeStage(
    device,
    [filter],
    SKY_OCCLUSION_FILTER_PROGRAM,
    SKY_OCCLUSION_FILTER_ENTRY,
    'Trillion3D cloud sky occlusion filter',
    failed,
  )
  return { filter, filtering: pipeline }
}
