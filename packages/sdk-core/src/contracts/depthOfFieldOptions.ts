import {
  atLeast,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettingsWith,
  resolveSetting,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'
import { refusal } from './nameMatch.ts'

/**
 * The depth of field of a view: what a lens does to the image of a scene that is not all at the one
 * distance it is focused on. Each pixel's depth gives it a circle of confusion — the disc a point at
 * that depth spreads to on the sensor, from the lens' focal length (the camera's field of view on a
 * sensor of `sensorWidth`), its aperture (`aperture`, an f-stop) and the focus (`focusDistance`) —,
 * larger for what is nearer or farther than the focus; the image is then blurred by those discs, the
 * foreground and the background each as a layer, with the shape of the lens' diaphragm
 * (`bladeCount` blades, rounded when `aperture` is above `minAperture`). The pass is OFF until the
 * focus distance (or the depth blur radius) is above 0, as the reference's; it costs nothing then.
 *
 * The pass holds the lens and the camera's film (`DepthOfFieldOptions`) — the camera of this
 * engine has none of them, so the pass is where they are set —, in the scene's units: metres, as
 * every distance of the engine, the reference's centimetres. How the blur
 * is drawn — the quality, the rings of the gather, the scattering of the bright highlights, the
 * out-of-focus recombine — is the view's: run-time settings (`./depthOfFieldRules.ts`).
 */

/** The largest finite number: the open end of a range. */

/** The pass's scalar settings, by field, each with the reference's default and the range the
 *  reference clamps it to:
 *  - `enabled` (`true`): the pass's own switch;
 *  - `focusDistance` (0 m): the distance in focus; 0 or less is off, as the reference's, whose
 *    default is a distance that cannot be focused on;
 *  - `aperture` (f/4) and `minAperture` (f/1.2): the lens' f-stop, and the one of its widest
 *    opening, past which the diaphragm's blades show as rounded; an `aperture` at or below the
 *    widest draws circles, a widest of 0 draws straight blades;
 *  - `bladeCount` (5): blades of the diaphragm, 4 to 16;
 *  - `sensorWidth` (24.576 mm, an APS-C sensor), `squeezeFactor` (1, an anamorphic lens' ratio) and
 *    `aspectRatioScalar` (1): the sensor the field of view lies on;
 *  - `depthBlurAmount` (1 km) and `depthBlurRadius` (0): a blur that grows with distance whatever
 *    the focus — the depth at which it reaches half its radius, and its radius in pixels of a
 *    1920-pixel image; a radius above 0 turns the pass on without a focus;
 *  - `petzvalBokeh` (0), `petzvalFalloff` (1), `petzvalExclusionBoxWidth` and `…Height` (0),
 *    `petzvalExclusionRadius` (0): the swirl of a Petzval lens, which stretches the bokeh near the
 *    edge of the image — its strength and sign, how fast it grows, the box in the middle of the
 *    image it leaves alone and the box's corner radius;
 *  - `barrelRadius` (5) and `barrelLength` (0): the lens barrel that clips the bokeh at the edge of
 *    the image (cat's eye), its radius and its length in centimetres, the radius at least half the
 *    aperture and half a centimetre; a length of 0 is no barrel.
 *  The three matte box flags are `matteBox`. */
export const DEPTH_OF_FIELD_VOLUME_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('enabled', true),
    number('focusDistance', 0, atLeast(0)),
    number('aperture', 4, [1, 32]),
    number('minAperture', 1.2, [0, 32]),
    integer('bladeCount', 5, [4, 16]),
    number('sensorWidth', 24.576, atLeast(0.1)),
    number('squeezeFactor', 1, [0.1, 10]),
    nonNegative('aspectRatioScalar', 1),
    number('depthBlurAmount', 1, [0.000001, 100]),
    nonNegative('depthBlurRadius', 0),
    number('petzvalBokeh', 0, [-10, 10]),
    number('petzvalFalloff', 1, [0, 100]),
    number('petzvalExclusionBoxWidth', 0, [0, 1]),
    number('petzvalExclusionBoxHeight', 0, [0, 1]),
    number('petzvalExclusionRadius', 0, [0, 1]),
    nonNegative('barrelRadius', 5),
    nonNegative('barrelLength', 0),
  ] as const))()

/** A panel around the front of the lens barrel that occludes the bokeh: its angle with the barrel
 *  (−90 to 90 degrees), its rotation around it (0 to 360) and its length (0, none, or more, in
 *  centimetres). */
export interface MatteBoxFlag {
  pitch?: number
  roll?: number
  length?: number
}
/** A matte box flag as the engine reads it. */
export interface ResolvedMatteBoxFlag {
  readonly pitch: number
  readonly roll: number
  readonly length: number
}
/** Panels a matte box holds. */
const MATTE_BOX_FLAGS = 3

/** What a page may pass to `effect.depthOfField`: any of the scalar settings
 *  (`DEPTH_OF_FIELD_VOLUME_RULES`) and the matte box's three flags; a field left out is the default. */
export interface DepthOfFieldOptions extends SettingOptions<typeof DEPTH_OF_FIELD_VOLUME_RULES> {
  matteBox?: readonly MatteBoxFlag[]
}
/** The depth of field as the engine reads it: every field set. */
export interface ResolvedDepthOfField extends SettingValues<typeof DEPTH_OF_FIELD_VOLUME_RULES> {
  readonly matteBox: readonly ResolvedMatteBoxFlag[]
}

/** The flags a matte box holds with none drawn: the reference's default. */
const NO_FLAGS: readonly ResolvedMatteBoxFlag[] = Object.freeze(
  Array.from({ length: MATTE_BOX_FLAGS }, () => Object.freeze({ pitch: 0, roll: 0, length: 0 })),
)

/** The rules of each matte box flag's fields, their names carrying the flag's place for the refusal. */
const MATTE_BOX_RULES = Array.from({ length: MATTE_BOX_FLAGS }, (_, at) => ({
  pitch: number(`matteBox[${at}].pitch`, 0, [-90, 90]),
  roll: number(`matteBox[${at}].roll`, 0, [0, 360]),
  length: nonNegative(`matteBox[${at}].length`, 0),
}))

/** The matte box's flags an option names: a flag or a field left out is the default. */
function resolveMatteBox(flags: readonly MatteBoxFlag[] | undefined) {
  if (flags === undefined) return NO_FLAGS
  if (!Array.isArray(flags) || flags.length > MATTE_BOX_FLAGS)
    return refusal('depthOfField')(`matteBox must list at most ${MATTE_BOX_FLAGS} flags`)
  return Object.freeze(
    MATTE_BOX_RULES.map((rules, at) => {
      const flag = flags[at] ?? {}
      return Object.freeze({
        pitch: resolveSetting(rules.pitch, flag.pitch),
        roll: resolveSetting(rules.roll, flag.roll),
        length: resolveSetting(rules.length, flag.length),
      })
    }),
  )
}

/**
 * The depth of field an option names: every field it leaves out is the default (`DEPTH_OF_FIELD_VOLUME_RULES`,
 * the reference's). The one reading of the option, whoever takes it — `effect.depthOfField`, a setter.
 * @throws TypeError naming the field and what it takes when one is out of its range.
 */
export function resolveDepthOfField(options: DepthOfFieldOptions = {}): ResolvedDepthOfField {
  return resolveSettingsWith(DEPTH_OF_FIELD_VOLUME_RULES, options, 'matteBox', resolveMatteBox)
}

/** Whether the depth of field draws nothing: it is switched off, or it has neither a focus
 *  distance nor a depth blur radius above 0 (the reference's switch on). */
export const depthOfFieldIdle = (value: ResolvedDepthOfField) =>
  !value.enabled || !(value.focusDistance > 0 || value.depthBlurRadius > 0)
