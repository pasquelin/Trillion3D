import { readSetting } from '../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/** Whether the surfaces mark the cells of the translucency lighting volume they read (`translucencyVolumeMarkVoxels`, off as the reference has it). */
export const marksVolumeVoxels = (rt: WebgpuPagesRuntime) =>
  readSetting(TRANSLUCENCY_VOLUME_RULES, rt.context, 'translucencyVolumeMarkVoxels')
