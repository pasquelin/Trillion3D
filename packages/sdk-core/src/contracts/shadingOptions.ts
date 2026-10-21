import { choiceSetting as choice, rulesOf, type SettingOptions } from './settingRules.ts'

/**
 * The run-time settings of the material pass's shading (`packages/sdk-browser/src/visibility/shader/shadeBinsWgsl.ts`):
 * how the shading bins hold each material class's pixels. They are the engine's own, read again at
 * each frame: no compiler job names them, so no manifest carries them and no cache key holds them.
 * None has quality levels: the scalability groups of the reference leave each at its default, so a
 * quality preset writes none (`../runtime/qualityLevels.ts`). Each is a world option
 * (`WorldOptions`), a session option (`MeasuredWorldOptions`), a render setting of the view
 * distance's group (`packages/sdk-browser/src/session/world/settings.ts`), and the LLM schemas name
 * it by its field and say what it means (`../llm/settingProperties.ts`). Each is read by the one
 * resolver of the rules (`resolveSetting`, `./settingRules.ts`) wherever it is taken — the world, a
 * session at its opening, the session's setter, the frame —: a value it takes as itself,
 * `undefined` or `null` its default, anything else refused with a `TypeError` naming the field and
 * the values it takes.
 */

/** The binning modes of `shadeBinningMode`, the reference's default first: `auto` as the class's
 *  shading asks — by quad of 2 × 2 where it reads a neighbour's derivative, by pixel otherwise;
 *  every class of the engine takes its gradients from its own triangle, so by pixel —, `pixel`
 *  every class's pixels one by one, `quad` every class's by quad, a quad's lanes on pixels of
 *  another class idle. The image is the same in each mode. */
const SHADE_BINNING_MODES = ['auto', 'pixel', 'quad'] as const
/** One binning mode. */
export type ShadeBinningMode = (typeof SHADE_BINNING_MODES)[number]

/** The shading's settings by field, each with the reference's default: the bins' mode as the
 *  classes ask. */
export const SHADING_RULES = /* @__PURE__ */ (() =>
  rulesOf([choice('shadeBinningMode', 'auto', SHADE_BINNING_MODES)] as const))()
/** The field of one setting of the shading. */
export type ShadingField = keyof typeof SHADING_RULES
/** The shading's settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type ShadingOptions = SettingOptions<typeof SHADING_RULES>
