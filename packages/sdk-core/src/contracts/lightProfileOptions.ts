import {
  contextReader,
  integerSetting as integer,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'
import { LIGHT_PROFILE_SLICES } from '../scene/light/contracts.ts'

/**
 * The run-time settings of the light profiles' atlas (`packages/sdk-browser/src/lighting/lightProfile/`): the
 * profiles the lights name (`SceneLight.iesProfile`) are kept in one texture, a slice each, made as large as
 * the profiles asked need and no larger, and made again when more are asked than it holds. Run-time settings,
 * as `./settingRules.ts` says: no compiler job names them, so no manifest carries them; each is read again at
 * each image, and each default is the reference's.
 *
 * - `lightProfileAtlasResolution` (256, from 16 to 4096): the texels a side of a slice; a profile of another side is resampled
 *   to it (bilinear, clamped) when it is written;
 * - `lightProfileAtlasMaxProfiles` (32, from 1 to `LIGHT_PROFILE_SLICES`): the most profiles the atlas holds; the slices it
 *   is made with are the profiles asked, up to this; a light whose profile has no slice shines as a lamp with none.
 */
export const LIGHT_PROFILE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('lightProfileAtlasResolution', 256, [16, 4096]),
    integer('lightProfileAtlasMaxProfiles', 32, [1, LIGHT_PROFILE_SLICES]),
  ] as const))()

/** The field of one setting of the light profiles' atlas. */
export type LightProfileField = keyof typeof LIGHT_PROFILE_RULES
/** The light profiles' settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type LightProfileOptions = SettingOptions<typeof LIGHT_PROFILE_RULES>

/** Each frame's reading of one setting of the light profiles' atlas from a runtime's context. */
export const readLightProfileSetting = /* @__PURE__ */ contextReader(LIGHT_PROFILE_RULES)
