import { lightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { screenProbeSettingsOf } from '../bounce/screen/settingsOf.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import {
  readSetting,
  resolveSettingsStamped,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  TRANSLUCENCY_GI_RULES,
  type TranslucencyGiValues,
} from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import {
  LIGHTING_DATA_FORMAT_RULES,
  lightingDataFormatOf,
} from '../../../../sdk-core/src/contracts/lightingDataFormatOptions.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { litImageShown } from '../../frame/prepare/contractLight.ts'
import { bounceLitImage } from '../bounce/screen/cast.ts'

/** The volume's settings as this image reads them: one object, rewritten. */
const resolved = {} as TranslucencyGiValues
export const translucencyGiSettings = (rt: WebgpuPagesRuntime) =>
  resolveSettingsStamped(TRANSLUCENCY_GI_RULES, rt.context, resolved)

/** Whether the volume is made this image: the setting is on, the lit image is shown and the screen probes cast (their parameters are the
 *  march's, and, where the cache is shared, they own the radiance cache the cells read). Whatever reads it, the surfaces or the fog's cells,
 *  does not decide: the volume is built whenever it is enabled. */
export const wanted = (rt: WebgpuPagesRuntime, settings: TranslucencyGiValues) =>
  settings.translucencyGi && litImageShown(rt) && bounceLitImage(rt)

/** The view distance, centimetres, at which the end distance is the setting's own: the scale is the view distance over it. */
const END_DISTANCE_VIEW_DISTANCE = 20000

/**
 * The depth of the volume's last slice, metres: the setting `translucencyGiEndDistance` scaled by the scene's view distance over
 * `END_DISTANCE_VIEW_DISTANCE`, the scale held to 0.1 to 100 and the result to the setting's own range, 0.01 to 1000. The scene's view
 * distance is `globalDistanceFieldTraceViewDistance`, the distance the scene is kept to while rays are marched through the global
 * distance field. The grid's slices and the levels of the volume's own radiance cache that cover it follow this one distance.
 */
export const translucencyGiEndDistanceOf = (rt: WebgpuPagesRuntime, v: TranslucencyGiValues) =>
  clamp(
    v.translucencyGiEndDistance *
      clamp(
        readSetting(
          GLOBAL_DISTANCE_FIELD_RULES,
          rt.context,
          'globalDistanceFieldTraceViewDistance',
        ) / END_DISTANCE_VIEW_DISTANCE,
        0.1,
        100,
      ),
    0.01,
    1000,
  )

/** The format of the volume's light this image: its own setting, or the shared lighting data format where its own is `global`. */
export const translucencyGiFormatSetting = (rt: WebgpuPagesRuntime, v: TranslucencyGiValues) =>
  lightingDataFormatOf(
    v.translucencyGiLightingDataFormat,
    readSetting(LIGHTING_DATA_FORMAT_RULES, rt.context, 'lightingDataFormat'),
  )

/** The probes the volume's cells read this image: its own cache's where it has one, the world's where shared, none where it reads no cache. */
export function translucencyCacheProbes(rt: WebgpuPagesRuntime, v: TranslucencyGiValues) {
  if (!v.translucencyGiRadianceCache) return undefined
  return v.translucencyGiShareRadianceCacheWithOpaque
    ? rt.bounce.probes
    : rt.bounce.translucency?.probes
}

/** The format the radiance cache the volume reads stores its final maps in this image: that of the maps held, else what the screen probes' settings
 *  ask of the device. */
export const translucencyCacheLight = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  v: TranslucencyGiValues,
) =>
  translucencyCacheProbes(rt, v)?.cache.views?.light ??
  lightAtlasFormat(screenProbeSettingsOf(rt).cache.light, device.features)
