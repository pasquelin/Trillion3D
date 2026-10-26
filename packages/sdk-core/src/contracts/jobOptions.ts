/**
 * The compile options besides the HLOD that a job names — the scene's temporal anti-aliasing, the
 * responsive objects, the settings by material name, the voxelized objects, the partition's scheme
 * and main grid or grids, the mesh build settings, the object settings and the volumetric lightmap's bake —, each read
 * by its own contract (`./materialOptions.ts`, `./voxelizeOptions.ts`, `./partitionOptions.ts`,
 * `./meshBuildOptions.ts`, `./objectOptions.ts`, `./lightmapBakeOptions.ts`) and written in the compiler's form: as job fields
 * (`jobOptionFields`) or as command-line flags (`jobOptionFlags`), each left out when the job names
 * none. What does not read is refused with a `TypeError`.
 */
import { materialJob, type MaterialJobOptions } from './materialOptions.ts'
import { voxelizeJob, type VoxelizeOption } from './voxelizeOptions.ts'
import { partitionFlags, partitionJobFields, type PartitionJobOptions } from './partitionOptions.ts'
import { lightmapBakeJob } from './lightmapBakeOptions.ts'
import type { LightmapBakeOption } from './lightmapBakeAbi.ts'
import { meshBuildJob, type MeshBuildOption } from './meshBuildOptions.ts'
import { objectSettingsJob, type ObjectSettingsOption } from './objectOptions.ts'

/** The options of a job these contracts read, each as the host writes it. */
export type JobOptions = MaterialJobOptions &
  PartitionJobOptions & {
    voxelize?: VoxelizeOption | null
    meshBuild?: MeshBuildOption | null
    objectSettings?: ObjectSettingsOption | null
    lightmapBake?: LightmapBakeOption | null
  }

/** The job fields of `job`'s options as the compiler reads them.
 *  @throws TypeError when an option does not read. */
export const jobOptionFields = (job: JobOptions) => ({
  ...materialJob.fields(job),
  ...voxelizeJob.fields(job),
  ...partitionJobFields(job),
  ...meshBuildJob.fields(job),
  ...objectSettingsJob.fields(job),
  ...lightmapBakeJob.fields(job),
})

/** The command-line flags of `options`, none for an option left out.
 *  @throws TypeError when an option does not read. */
export const jobOptionFlags = (options: JobOptions): string[] => [
  ...materialJob.flags(options),
  ...voxelizeJob.flags(options),
  ...partitionFlags(options),
  ...meshBuildJob.flags(options),
  ...objectSettingsJob.flags(options),
  ...lightmapBakeJob.flags(options),
]
