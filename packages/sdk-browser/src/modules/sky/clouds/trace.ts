import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { cloudMaterialLayoutEntries } from './materialWgsl.ts'
import { CLOUD_FORMAT, type ImageSize } from './reconstructLayout.ts'
import { CLOUD_TRACE_BINDING as B } from './traceLayout.ts'
import {
  CLOUD_TRACE_AIR,
  CLOUD_TRACE_ENTRY,
  CLOUD_TRACE_GROUP_SIZE,
  CLOUD_TRACE_PROGRAM,
} from './traceWgsl.ts'

/**
 * THE VIEW TRACING, DECLARED: its two bind group layouts and its pipeline, and the size of its
 * dispatch. Nothing here is wired into a frame; the pass's owner makes the textures
 * (`reconstructLayout.ts`), the groups and the dispatch.
 *
 * Group 0 is the air's (`CLOUD_TRACE_AIR`: the light buffer, the transmittance table and its
 * sampler, the image's frame), made by the atmosphere's one way to a group. Group 1 holds the
 * cloud material's block and textures and its sampler (seven bindings from `B.material`,
 * `cloudMaterialLayoutEntries`), the trace's block (`writeCloudTrace`), the blue noise,
 * the scene's depth range and the three traced images, written (`reconstructLayout.ts`).
 */
export function cloudTraceLayoutEntries(): GPUBindGroupLayoutEntry[] {
  return [
    ...cloudMaterialLayoutEntries(B.material),
    computeUniformEntry(B.block),
    computeTextureEntry(B.blueNoise, 'float'),
    computeTextureEntry(B.depthRange, 'unfilterable-float'),
    computeStorageTextureEntry(B.colour, CLOUD_FORMAT),
    computeStorageTextureEntry(B.secondary, CLOUD_FORMAT),
    computeStorageTextureEntry(B.depth, CLOUD_FORMAT),
  ]
}

/** The groups to dispatch for the traced image of the frame's plan (`CloudFramePlan.sizes`): one
 *  thread to a texel of the traced image. */
export function cloudTraceDispatch(traced: ImageSize) {
  return {
    x: workgroupCount(traced.view.width, CLOUD_TRACE_GROUP_SIZE),
    y: workgroupCount(traced.view.height, CLOUD_TRACE_GROUP_SIZE),
    z: 1,
  }
}

/** The pass's layouts and its pipeline, asked now, off the frame; `failed` hears a failure to
 *  compile. The caller releases nothing: a pipeline and its layouts are the device's. */
export function createCloudTracePass(device: GPUDevice, failed: (error: unknown) => void) {
  const air = device.createBindGroupLayout({
    entries: airLayoutEntries(CLOUD_TRACE_AIR, COMPUTE),
  })
  const cloud = device.createBindGroupLayout({ entries: cloudTraceLayoutEntries() })
  const label = 'Trillion3D cloud view tracing'
  const module = device.createShaderModule({ label, code: CLOUD_TRACE_PROGRAM.code })
  const pipeline = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [air, cloud] }),
    module,
    CLOUD_TRACE_ENTRY,
    undefined,
    label,
  ).ask()
  pipeline.prepare().catch(failed)
  return { air, cloud, pipeline }
}
