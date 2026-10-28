import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { LIGHTING_DATA_FORMAT_RULES } from '../../../../sdk-core/src/contracts/lightingDataFormatOptions.ts'
import { lightAtlasFormat, type LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * THE FORMAT THE SURFACE CACHE'S LIGHT IS STORED IN: the lighting data format (`lightingDataFormat`) on the device's features (`lightAtlasFormat`), which the atlases
 * are made in (`atlases.ts`) and every pass that writes or reads their light is compiled for.
 */

/** The format the setting asks of `device` for the cache's light this image. */
export const surfaceCacheLightWanted = (
  rt: Pick<WebgpuPagesRuntime, 'context'>,
  device: GPUDevice,
) =>
  lightAtlasFormat(
    readSetting(LIGHTING_DATA_FORMAT_RULES, rt.context, 'lightingDataFormat'),
    device.features,
  )

/**
 * The format the cache's light is read in this image: that of the atlases held, which the passes that read them are compiled for, else the one the setting
 * asks. A setting that moved is taken by the cache's next update, which makes its atlases again (`ensureSurfaceAtlases`).
 */
export const surfaceCacheLightOf = (
  rt: Pick<WebgpuPagesRuntime, 'context' | 'surfaceCache'>,
  device: GPUDevice,
): LightAtlasFormat => rt.surfaceCache?.atlases?.light ?? surfaceCacheLightWanted(rt, device)
