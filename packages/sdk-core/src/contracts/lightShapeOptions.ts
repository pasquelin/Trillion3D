import {
  contextReader,
  flagSetting as flag,
  numberSetting as number,
  ANY_NUMBER,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/**
 * The run-time settings of the light shapes' visualization (`packages/sdk-browser/src/lighting/lightShape/`): each local light (point, spot,
 * rectangle) drawn as a wireframe of its reach over the lit image, in a colour of its own, faint where it is far from a surface and fading
 * in and out when the view is switched. Run-time settings, as `./settingRules.ts` says: no compiler job names them, so no manifest carries
 * them; each is read again at each image, and each default is the reference's.
 *
 * - `visualizeLightShape` (off): draws the shapes;
 * - `visualizeLightShapeFadeDuration` (0.5, seconds, at least 0): the time the shapes take to fade in or out when the view is switched;
 * - `visualizeLightShapeMaxDelayDistance` (4000 centimetres, at least 100): the distance within which a fade in is delayed, the delay
 *   growing linearly as the shape's surface comes nearer the eye, so that the farther ones appear first;
 * - `visualizeLightShapeMaxDelay` (2.5, seconds, at least 0): the longest of those delays;
 * - `visualizeLightShapeMaxOpacity` (0.1, from 0 to 1): the opacity of each wireframe at full.
 * The three that take any number are held to their ranges where they are read.
 */
export const LIGHT_SHAPE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('visualizeLightShape', false),
    number('visualizeLightShapeFadeDuration', 0.5, ANY_NUMBER),
    number('visualizeLightShapeMaxDelayDistance', 4000, ANY_NUMBER),
    number('visualizeLightShapeMaxDelay', 2.5, ANY_NUMBER),
    number('visualizeLightShapeMaxOpacity', 0.1, ANY_NUMBER),
  ] as const))()

/** The field of one setting of the light shapes' visualization. */
export type LightShapeField = keyof typeof LIGHT_SHAPE_RULES
/** The light shapes' settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type LightShapeOptions = SettingOptions<typeof LIGHT_SHAPE_RULES>

/** Each frame's reading of one setting of the light shapes' visualization from a runtime's context. */
export const readLightShapeSetting = /* @__PURE__ */ contextReader(LIGHT_SHAPE_RULES)

/** The settings a frame draws with, each held to its range: the fade duration and the longest delay at least 0, the distance of the delay at least 100 centimetres, the opacity within 0 and 1. */
export const lightShapeValues = (read: (field: LightShapeField) => number) => ({
  fadeDuration: Math.max(read('visualizeLightShapeFadeDuration'), 0),
  maxDelayDistance: Math.max(read('visualizeLightShapeMaxDelayDistance'), 100),
  maxDelay: Math.max(read('visualizeLightShapeMaxDelay'), 0),
  maxOpacity: clamp(read('visualizeLightShapeMaxOpacity'), 0, 1),
})
