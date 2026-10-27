import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import {
  readSetting,
  resolveSettingsStamped,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  TRANSLUCENCY_GI_RULES,
  type TranslucencyGiValues,
} from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { litImageShown } from '../../frame/prepare/contractLight.ts'
import { screenProbesCast } from '../bounce/screen/cast.ts'

/** The images a volume that is no longer made keeps what it made for before it gives it back (a camera that is not a perspective for a
 *  moment, a setting turned off and on): its textures, and the radiance cache of its own. */
export const KEEP_IMAGES = 8

/** The volume's settings as this image reads them: one object, rewritten. */
const resolved = {} as TranslucencyGiValues
export const translucencyGiSettings = (rt: WebgpuPagesRuntime) =>
  resolveSettingsStamped(TRANSLUCENCY_GI_RULES, rt.context, resolved)

/** Whether the volume is made this image: the setting is on, the lit image is shown and the screen probes cast (their parameters are the
 *  march's, and, where the cache is shared, they own the radiance cache the cells read). Whatever reads it, the surfaces or the fog's cells,
 *  does not decide: the volume is built whenever it is enabled. */
export const wanted = (rt: WebgpuPagesRuntime, settings: TranslucencyGiValues) =>
  settings.translucencyGi && litImageShown(rt) && screenProbesCast(rt)

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
