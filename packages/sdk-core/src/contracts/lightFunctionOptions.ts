import {
  choiceSetting as choice,
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  INT32_RANGE,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the light functions (`packages/sdk-browser/src/lighting/lightFunction/`):
 * a light that holds a light function material (`material.lightFunction`) multiplies its colour, at
 * each point it lights, by what the material gives there. The materials of the scene's lights are
 * drawn once each, into a slot of one atlas, and every consumer reads the atlas by the light's
 * index. Run-time settings, as `./settingRules.ts` says: no compiler job names them, so no manifest
 * carries them; each is read again at each image, and each default is the reference's.
 *
 * `lightFunctionAtlas` is the switch of the whole system; the consumers' say which read the
 * atlas — the opaque lighting, the volumetric fog's local lights (its sun always reads it), the
 * bounce's lights, the translucent layers. Past the switch, a consumer is on when it is asked for and the atlas is made
 * only when one of them is.
 */

/** What an atlas texel holds: `'grey'`, one channel in [0, 1], the colour's mean; `'colour'`, three. */
const LIGHT_FUNCTION_FORMATS = ['grey', 'colour'] as const

/** The smallest slot, in texels a side: the reference never makes one smaller. */
const LIGHT_FUNCTION_SLOT_LEAST = 32
/** The fewest and the most slots an atlas has a side: its slots number the square of its size, 256
 *  at most. */
const LIGHT_FUNCTION_SIZE_RANGE = [2, 16] as const

/** The light functions' settings by field, each with the reference's default:
 *  `lightFunctionAtlas` (on) — whether the atlas is made —; `lightFunctionSlotResolution` (128) —
 *  texels a side of a slot, at least 32 —; `lightFunctionAtlasSize` (4) — slots a side of the atlas,
 *  from 2 to 16, so 16 materials at the default —; `lightFunctionMaxLights` (−1, no limit) — the most
 *  lights that read the atlas; a light past it has no light function —; `lightFunctionFormat`
 *  (`'grey'`); `lightFunctionDeferred` (on) — the opaque lighting reads the atlas —;
 *  `lightFunctionFog` (on) — the volumetric fog's local lights read it, its sun's always does —;
 *  `lightFunctionBounce` (on) — the bounce's lights (the probes' rays, the screen probes' scene
 *  traces) read it —; `lightFunctionTranslucent` (off) — the translucent layers read it. */
export const LIGHT_FUNCTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('lightFunctionAtlas', true),
    integer('lightFunctionSlotResolution', 128, [LIGHT_FUNCTION_SLOT_LEAST, 32768]),
    integer('lightFunctionAtlasSize', 4, LIGHT_FUNCTION_SIZE_RANGE),
    integer('lightFunctionMaxLights', -1, [-1, INT32_RANGE[1]]),
    choice('lightFunctionFormat', 'grey', LIGHT_FUNCTION_FORMATS),
    flag('lightFunctionDeferred', true),
    flag('lightFunctionFog', true),
    flag('lightFunctionBounce', true),
    flag('lightFunctionTranslucent', false),
  ] as const))()
/** The field of one setting of the light functions. */
export type LightFunctionField = keyof typeof LIGHT_FUNCTION_RULES
/** The light functions' settings as a host writes them, by their fields: each its value, or nothing
 *  for its default. */
export type LightFunctionOptions = SettingOptions<typeof LIGHT_FUNCTION_RULES>
/** The values of the light functions' settings, resolved. */
export type LightFunctionValues = SettingValues<typeof LIGHT_FUNCTION_RULES>

/** The atlas the settings make: its slots a side, their size in texels, and the texture's side. The
 *  slot is cut to fit when the whole would pass the device's largest texture (`maxSide`). */
export function lightFunctionAtlasShape(
  values: Pick<LightFunctionValues, 'lightFunctionAtlasSize' | 'lightFunctionSlotResolution'>,
  maxSide: number,
) {
  const edge = values.lightFunctionAtlasSize
  let slot = values.lightFunctionSlotResolution
  if (edge * slot > maxSide) slot = Math.floor(maxSide / edge)
  return { edge, slot, side: edge * slot }
}

/** Each frame's reading of one setting of the light functions from a runtime's context. */
export const readLightFunctionSetting = contextReader(LIGHT_FUNCTION_RULES)
