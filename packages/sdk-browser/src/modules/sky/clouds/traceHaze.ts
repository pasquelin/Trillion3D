import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import { CLOUD_FORMAT } from './reconstructLayout.ts'
import {
  CLOUD_HAZE_BINDING as B,
  CLOUD_HAZE_ENTRY,
  cloudHazeAir,
  cloudHazeProgram,
} from './traceHazeProgram.ts'

// The pass of the haze on the clouds, per pixel (`cloudHighQualityAerial`): its layouts and its
// pipeline, its groups the trace's (`cloudTraceDispatch`); its program and its bindings are
// `traceHazeProgram.ts`'s.

/** The layout entries of group 1: the block, the cloud image and the depth image read, the image
 *  written. */
const cloudHazeLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.block),
  computeTextureEntry(B.colour, 'unfilterable-float'),
  computeTextureEntry(B.depth, 'unfilterable-float'),
  computeStorageTextureEntry(B.out, CLOUD_FORMAT),
]

/** The pass's layouts and pipeline for the air's `shape`, asked now, off the frame; `failed` hears
 *  a failure to compile. */
export function createCloudHazePass(
  device: GPUDevice,
  failed: (error: unknown) => void,
  shape: AirShape = DEFAULT_AIR_SHAPE,
) {
  const air = device.createBindGroupLayout({
    entries: airLayoutEntries(cloudHazeAir(shape), COMPUTE, shape),
  })
  const cloud = device.createBindGroupLayout({ entries: cloudHazeLayoutEntries() })
  const pipeline = askedComputeStage(
    device,
    [air, cloud],
    cloudHazeProgram(shape).code,
    CLOUD_HAZE_ENTRY,
    'Trillion3D cloud haze',
    failed,
  )
  return { air, cloud, pipeline }
}
