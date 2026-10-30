import {
  contextReader,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the resolution the translucent layers are drawn at (`packages/sdk-browser/src/blend/translucency.ts`). The layers
 * are drawn apart from the lit image, into targets of their own; with a share under 100 those targets, and the depth the layers are tested
 * against (the scene's depth taken at the targets' size), are smaller than the image, and the composition scales them up. Run-time settings,
 * as `./settingRules.ts` says: no compiler job names them, so no manifest carries them; each is read again at each image, a change of the
 * share or of the basis remaking the targets, and each default is the reference's.
 *
 * - `translucencyScreenPercentage` (100, from 0 to 100): the share of the resolution the translucent layers are drawn at; 100 draws them at
 *   the image's size, over the scene's own depth;
 * - `translucencyScreenPercentageBasis` (0, 0 or 1): the resolution the share is of — 0 the render size, which follows the render scale;
 *   1 the display's size, the share then divided by the render scale, so that the layers keep the display's resolution while the render
 *   scale drops;
 * - `translucencyUpsampleMode` (1, 0 or 1): how the smaller targets are scaled up when composed — 0 bilinear; 1 the nearest depth
 *   neighbour, of the four texels around a pixel the one whose depth is nearest the scene's there, which only a share of 50 uses in the
 *   compositions (any other share composes bilinear); the depth of field's recombine, which composes the layers in its own pass, always
 *   scales smaller layers up that way.
 */
export const SEPARATE_TRANSLUCENCY_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('translucencyScreenPercentage', 100, [0, 100]),
    integer('translucencyScreenPercentageBasis', 0, [0, 1]),
    integer('translucencyUpsampleMode', 1, [0, 1]),
  ] as const))()

/** The field of one setting of the resolution of the translucent layers. */
export type SeparateTranslucencyField = keyof typeof SEPARATE_TRANSLUCENCY_RULES
/** The resolution's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type SeparateTranslucencyOptions = SettingOptions<typeof SEPARATE_TRANSLUCENCY_RULES>

/** Each frame's reading of one setting of the translucent layers' resolution from a runtime's context. */
export const readSeparateTranslucencySetting = /* @__PURE__ */ contextReader(
  SEPARATE_TRANSLUCENCY_RULES,
)
