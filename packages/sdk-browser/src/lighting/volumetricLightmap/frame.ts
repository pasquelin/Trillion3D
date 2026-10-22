import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  VOLUMETRIC_LIGHTMAP_RULES,
  type VolumetricLightmapValues,
} from '../../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import { ledgerTentative } from '../../gpu/core/deviceLedger.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createVolumetricLightmapGpu, type VolumetricLightmapGpu } from './gpu.ts'

/**
 * THE VOLUMETRIC LIGHTMAP IN THE FRAME. A session whose cache carries one (`EngineContext.volumetricLightmapData`)
 * has its textures made at the first image that asks for them (`volumetricLightmapOf`), once, and freed
 * with the runtime (`disposeVolumetricLightmap`). A session whose cache carries none allocates nothing.
 * A lightmap the device refuses — past its 3D limit, or its budget — is diagnosed once and left out: the
 * passes that would read it read none.
 */

/** What the runtime keeps of the lightmap: its GPU resources, none where they could not be made. */
export interface VolumetricLightmapFrameState {
  gpu?: VolumetricLightmapGpu
}

const settings = {} as VolumetricLightmapValues

/** The lightmap on the GPU where the session has one, the `volumetricLightmap` setting is on and the
 *  device made its textures; none otherwise. */
export function volumetricLightmapOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const data = rt.context.volumetricLightmapData
  if (!data) return undefined
  resolveSettingsInto(VOLUMETRIC_LIGHTMAP_RULES, rt.context, settings)
  if (!settings.volumetricLightmap) return undefined
  if (!rt.volumetricLightmap) {
    const held: VolumetricLightmapFrameState = (rt.volumetricLightmap = {})
    try {
      held.gpu = ledgerTentative(device, () => createVolumetricLightmapGpu(device, data))
    } catch (error) {
      rt.diag.diagnosticFailure('volumetric-lightmap-refused', error)
    }
  }
  return rt.volumetricLightmap.gpu
}

/** Frees the lightmap of `rt`. */
export function disposeVolumetricLightmap(rt: Pick<WebgpuPagesRuntime, 'volumetricLightmap'>) {
  rt.volumetricLightmap?.gpu?.dispose()
  rt.volumetricLightmap = undefined
}
