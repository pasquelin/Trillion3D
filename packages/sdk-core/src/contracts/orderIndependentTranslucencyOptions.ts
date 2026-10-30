import {
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/**
 * The run-time settings of the per-pixel sorted translucency (`packages/sdk-browser/src/blend/oit/`): the translucent layers that blend
 * `normal` or `additive` do not blend in the order they are drawn but are collected, each fragment with its light, its transmittance and its
 * depth, in a short list a pixel holds, and composed front to back once the pass has drawn them all, so that two layers that cross are
 * ordered right at every pixel, not by object. Run-time settings, as `./settingRules.ts` says: no compiler job names them, so no manifest
 * carries them; each is read again at each image but the first, and each default is the reference's.
 *
 * - `oitSortedPixels` (off): the project switch that makes the programs of the translucent layers able to collect; read once, when the
 *   session opens, as the programs are made with it. A device whose fragment stage binds eight storage buffers or fewer keeps the layers
 *   blended in the order they are drawn;
 * - `oitSortedPixelsEnable` (on): the run-time switch, read each image, that sorts the layers of the programs `oitSortedPixels` made;
 * - `oitPassType` (3, from 0 to 3): the passes sorted, the bits of 1 the standard translucency, 2 the separate translucency; every layer
 *   of the engine is drawn apart from the lit image (the separate translucency), so the bit 2 decides and the bit 1 changes nothing;
 * - `oitMaxSampleCount` (4, from 1 to 16): the fragments a pixel keeps, rounded down to a square (4 stays 4, 8 keeps 4, 16 stays 16);
 * - `oitMethod` (1, 0 or 1): the name the debug text gives the method, 0 the k-buffer, 1 the multi-layer alpha blending; the fragments are
 *   kept in depth order and those past the room merged into the last one whichever it is, as the reference always runs the multi-layer one;
 * - `oitTransmittanceThreshold` (0.05, from 0 to 1): a fragment behind the last one stored, whose merged transmittance is under it in
 *   every channel, adds nothing;
 * - `oitDebug` (0, from 0 to 3): the figures of the pixel under the cursor, written over the image: 1 for the standard translucency (the
 *   engine has none), 2 for the separate one;
 * - `oitDebugCursorX`, `oitDebugCursorY` (-1): the pixel of the figures, from the image's top left; a value under 1 or on the last row or
 *   column writes the figures of no pixel, as the reference's cursor does when it is out of the view.
 * The settings that take a number are held to their ranges where they are read.
 */
export const ORDER_INDEPENDENT_TRANSLUCENCY_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('oitSortedPixels', false),
    flag('oitSortedPixelsEnable', true),
    integer('oitPassType', 3, [0, 3]),
    integer('oitMaxSampleCount', 4, [1, 16]),
    integer('oitMethod', 1, [0, 1]),
    number('oitTransmittanceThreshold', 0.05, [0, 1]),
    integer('oitDebug', 0, [0, 3]),
    integer('oitDebugCursorX', -1, [-1, 65535]),
    integer('oitDebugCursorY', -1, [-1, 65535]),
  ] as const))()

/** The field of one setting of the sorted translucency. */
export type OrderIndependentTranslucencyField = keyof typeof ORDER_INDEPENDENT_TRANSLUCENCY_RULES
/** The sorted translucency's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type OrderIndependentTranslucencyOptions = SettingOptions<
  typeof ORDER_INDEPENDENT_TRANSLUCENCY_RULES
>

/** Each frame's reading of one setting of the sorted translucency from a runtime's context. */
export const readOrderIndependentTranslucencySetting = /* @__PURE__ */ contextReader(
  ORDER_INDEPENDENT_TRANSLUCENCY_RULES,
)

/** The bit of the standard translucency in `oitPassType`, and the bit of the separate one. */
export const OIT_PASS_REGULAR = 1
export const OIT_PASS_SEPARATE = 2

/** The samples a pixel keeps for a `oitMaxSampleCount` asked: rounded down to a square, so that they tile a square of texels (the side is `Math.sqrt` of it). */
export const oitSampleCount = (asked: number) => {
  const side = Math.floor(Math.sqrt(clamp(Math.trunc(asked), 1, 16)))
  return side * side
}
