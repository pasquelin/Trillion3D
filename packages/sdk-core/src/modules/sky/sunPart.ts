import { DEG2RAD } from '../../../../math/src/constants.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import { CLOUD_SHADOW_LIGHT_RULES, type CloudShadowLight } from './cloudShadow.ts'
import { LIGHT_SHAFT_LIGHT_RULES, type LightShaftLight } from './lightShafts.ts'

/**
 * The sun part of the sky module: one directional light, the air's first light, with the settings
 * of its shadows on the air and the clouds, of its light shafts and of its cloud shadow map. Run-time
 * settings, as `../../contracts/settingRules.ts` says. The part's defaults are those of the sun of a
 * new world's level: 6 lux, a black body of 6500 K, a disk of 0.7357 degrees, shadows on the air and
 * the clouds, light shaft occlusion on, shadows to 200 metres.
 */

/** The settings of the light itself, by field:
 * - `intensity` (6) and `color` (white, linear): the illuminance and the colour it is multiplied by;
 * - `useTemperature` (true; the light's is false) and `temperatureKelvin` (6500): the colour of a
 *   black body the colour is multiplied by (`./sunColour.ts`);
 * - `angle` (0.7357): the disk's apparent diameter in degrees, which sizes the soft shadow and the
 *   disk drawn in the sky;
 * - `rotation` (-16.2856, 43.7319, 112.3607): pitch, yaw and roll in degrees, as `sunDirection`
 *   reads them; the roll turns the light about its own axis and changes nothing;
 * - `shadowDistance` (200; the light's is 400) in metres and `castShadow` (true);
 * - `shadowsAir` (true; the light's is false): the shadow also shades the air; `shadowsFog` (true);
 * - `fogScattering` (1): how much the volumetric fog and the clouds scatter of it;
 * - `atmosphereSunIndex` (0): the air's first light or its second (0 or 1);
 * - `transmittancePerPixel` (false) and `sunDiskTint` (white, linear): the air's per-point
 *   transmittance and the disk's colour factor.
 */
const SUN_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('intensity', 6),
    vector('color', [1, 1, 1]),
    flag('useTemperature', true),
    number('temperatureKelvin', 6500, ANY),
    number('angle', 0.7357, [0, 180]),
    vector('rotation', [-16.2856, 43.7319, 112.3607]),
    nonNegative('shadowDistance', 200),
    flag('castShadow', true),
    flag('shadowsAir', true),
    flag('shadowsFog', true),
    nonNegative('fogScattering', 1),
    integer('atmosphereSunIndex', 0, [0, 1]),
    flag('transmittancePerPixel', false),
    vector('sunDiskTint', [1, 1, 1]),
  ] as const))()

/** What a host writes for the part: any field of the light, its light shafts and its cloud shadow. */
export type SunOptions = SettingOptions<typeof SUN_LIGHT_RULES> &
  SettingOptions<typeof LIGHT_SHAFT_LIGHT_RULES> &
  SettingOptions<typeof CLOUD_SHADOW_LIGHT_RULES>

/** The light's own settings as resolved. */
export type SunLightSettings = SettingValues<typeof SUN_LIGHT_RULES>

/** The settings the level turns on that the light shafts and the cloud shadow rules have off. */
const LEVEL_FIELDS = { shaftOcclusion: true, shadowsClouds: true } as const

/** The part as the lights and the passes read it. */
export interface SunPart {
  readonly light: SunLightSettings
  readonly shafts: LightShaftLight
  readonly cloudShadow: CloudShadowLight
  /** The unit vector the light travels along, in the engine's axes (`sunDirection`). */
  readonly direction: readonly [number, number, number]
}

/**
 * The unit vector a light of rotation (`pitch`, `yaw`, `roll`) in degrees travels along: the
 * forward axis of a frame whose up axis is the engine's `+y`, pitched up when positive and turned
 * about `+y` by the yaw; a negative pitch shines down. The handedness is kept.
 */
function sunDirection(rotation: readonly number[]): [number, number, number] {
  const pitch = rotation[0] * DEG2RAD
  const yaw = rotation[1] * DEG2RAD
  const along = Math.cos(pitch)
  return [along * Math.cos(yaw), Math.sin(pitch), -along * Math.sin(yaw)]
}

/**
 * The one reading of the part's merged fields: the light's, its light shafts' and its cloud
 * shadow's settings, each its default when the fields hold none (those of the level for the two
 * switches `LEVEL_FIELDS` names).
 * @throws TypeError naming a field the part does not have, or a value a field does not take.
 */
export function resolveSunPart(fields: Readonly<Record<string, unknown>>): SunPart {
  const names = [
    ...Object.keys(SUN_LIGHT_RULES),
    ...Object.keys(LIGHT_SHAFT_LIGHT_RULES),
    ...Object.keys(CLOUD_SHADOW_LIGHT_RULES),
  ]
  const held: Record<string, unknown> = {
    ...LEVEL_FIELDS,
    ...fieldsOf(fields, names, 'the sun part', refusal('sun')),
  }
  const light = resolveSettings(SUN_LIGHT_RULES, held)
  return {
    light,
    shafts: resolveSettings(LIGHT_SHAFT_LIGHT_RULES, held),
    cloudShadow: resolveSettings(CLOUD_SHADOW_LIGHT_RULES, held),
    direction: sunDirection(light.rotation),
  }
}
