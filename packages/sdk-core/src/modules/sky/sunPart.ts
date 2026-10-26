import { DEG2RAD } from '../../../../math/src/constants.ts'
import { fieldsOf, refusal } from '../../contracts/nameMatch.ts'
import {
  ANY_NUMBER as ANY,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'
import { DEFAULT_TEMPERATURE_KELVIN } from '../../scene/light/fields.ts'
import { CLOUD_SHADOW_LIGHT_RULES, type CloudShadowLight } from './cloudShadow.ts'
import { LIGHT_SHAFT_LIGHT_RULES, type LightShaftLight } from './lightShafts.ts'

/**
 * The sun part of the sky module: one directional light, the air's first light, with the settings
 * of its shadows on the air and the clouds, of its light shafts and of its cloud shadow map. Run-time
 * settings, as `../../contracts/settingRules.ts` says. The part's defaults are those of the sun of a
 * new world's level, not the directional light component's: where they differ, the field says which.
 * The values are the level's sun's: 6 lux, the temperature on, a disk of 0.7357 degrees, shadows
 * to 20000 cm, no distance-field shadows (their distance 30000 cm), light shaft occlusion, shadows
 * on the clouds and on the air on, and the rotation it is placed at. Every field that sun does not set is the directional light's own default.
 */

/** The settings of the light itself, by field:
 * - `intensity` (6) and `color` (white, linear): the illuminance and the colour it is multiplied by;
 * - `useTemperature` (true, the level's; the component's is false) and `temperatureKelvin` (6500,
 *   the component's, which the level leaves): the colour of a
 *   black body the colour is multiplied by (`./sunColour.ts`);
 * - `angle` (0.7357): the disk's apparent diameter in degrees, which sizes the soft shadow and the
 *   disk drawn in the sky;
 * - `rotation` (-16.2856, 43.7319, 112.3607, the level's): pitch, yaw and roll in degrees, as
 *   `sunDirection` reads them; the roll turns the light about its own axis and changes nothing;
 * - `shadowDistance` (200, the level's; the component's is 400) in metres and `castShadow` (true);
 * - `distanceFieldShadows` (false, the level's; the component's is true) and
 *   `distanceFieldShadowDistance` (300, the level's; the component's is 512) in metres: whether
 *   the distance-field cascade is made, and where it ends;
 * - `shadowsAir` (true, the level's; the component's is false): the shadow also shades the air;
 *   `shadowsFog` (true);
 * - `fogScattering` (1): how much the volumetric fog and the clouds scatter of it;
 * - `atmosphereSunIndex` (0): the air's first light or its second (0 or 1);
 * - `forwardShadingPriority` (0): its priority for the one directional light the translucent
 *   surfaces' cloud shade and the volumetric fog take (`SceneLight.forwardShadingPriority`);
 * - `transmittancePerPixel` (false) and `sunDiskTint` (white, linear): the air's per-point
 *   transmittance and the disk's colour factor.
 */
const SUN_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('intensity', 6),
    vector('color', [1, 1, 1]),
    flag('useTemperature', true),
    number('temperatureKelvin', DEFAULT_TEMPERATURE_KELVIN, ANY),
    number('angle', 0.7357, [0, 180]),
    vector('rotation', [-16.2856, 43.7319, 112.3607]),
    nonNegative('shadowDistance', 200),
    flag('castShadow', true),
    flag('distanceFieldShadows', false),
    nonNegative('distanceFieldShadowDistance', 300),
    flag('shadowsAir', true),
    flag('shadowsFog', true),
    nonNegative('fogScattering', 1),
    integer('atmosphereSunIndex', 0, [0, 1]),
    count('forwardShadingPriority', 0, 0),
    flag('transmittancePerPixel', false),
    vector('sunDiskTint', [1, 1, 1]),
  ] as const))()

/** The light's own settings as resolved. */
type SunLightSettings = SettingValues<typeof SUN_LIGHT_RULES>

/** The settings the level turns on that the light shafts' and the cloud shadow rules have off
 *  (`shaftOcclusion`, `shadowsClouds`: the directional light's own are off). */
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
