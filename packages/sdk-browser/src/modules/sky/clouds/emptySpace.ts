import {
  COMPUTE,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import {
  CLOUD_EMPTY_SPACE_BINDING as B,
  CLOUD_EMPTY_SPACE_ENTRY,
  CLOUD_EMPTY_SPACE_FORMAT,
  emptySpaceProgram,
} from './emptySpaceWgsl.ts'
import { cloudMaterialLayoutEntries } from './materialWgsl.ts'
import { CLOUD_EMPTY_SPACE_SIDE } from './traceOptions.ts'
import { CLOUD_TRACE_AIR } from './traceWgsl.ts'

/**
 * THE EMPTY-SPACE TABLE, DECLARED: its two bind group layouts, its pipeline and its dispatch. Group
 * 0 is the air's, as the view tracing's; group 1 holds the material's seven bindings, the trace's
 * block (`writeCloudTrace`, the very block the tracing reads) and the table, written
 * (`CLOUD_EMPTY_SPACE_FORMAT`, `CLOUD_EMPTY_SPACE_SIDE` texels across and down). The pass runs for a
 * frame that asked for the table (`cloudTraceKey`), never in a reflection, before the
 * tracing; the tracing reads the table it wrote.
 */
export function cloudEmptySpaceLayoutEntries(): GPUBindGroupLayoutEntry[] {
  return [
    ...cloudMaterialLayoutEntries(B.material),
    computeUniformEntry(B.block),
    computeStorageTextureEntry(B.table, CLOUD_EMPTY_SPACE_FORMAT),
  ]
}

/** The groups to dispatch: one to a texel of the table. */
export const CLOUD_EMPTY_SPACE_DISPATCH = {
  x: CLOUD_EMPTY_SPACE_SIDE,
  y: CLOUD_EMPTY_SPACE_SIDE,
  z: 1,
} as const

/** The pass's layouts and its pipeline, asked now, off the frame, with the corners option (the
 *  froxel's corners are read as well as its centre); `failed` hears a failure to compile. */
export function createCloudEmptySpacePass(
  device: GPUDevice,
  corners: boolean,
  failed: (error: unknown) => void,
) {
  const air = device.createBindGroupLayout({
    entries: airLayoutEntries(CLOUD_TRACE_AIR, COMPUTE),
  })
  const cloud = device.createBindGroupLayout({ entries: cloudEmptySpaceLayoutEntries() })
  const label = 'Trillion3D cloud empty space'
  const module = device.createShaderModule({ label, code: emptySpaceProgram().code })
  const pipeline = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [air, cloud] }),
    module,
    CLOUD_EMPTY_SPACE_ENTRY,
    { EMPTY_SPACE_CORNERS: corners ? 1 : 0 },
    label,
  ).ask()
  pipeline.prepare().catch(failed)
  return { air, cloud, pipeline }
}
