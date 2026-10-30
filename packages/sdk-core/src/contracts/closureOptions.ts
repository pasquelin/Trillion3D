import {
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/** The most closures a pixel holds, the format's bound: `MAX_CLOSURES` (`../world/material/graph/closures.ts`, which a contract does not import; a test holds the two equal). */
export const CLOSURES_MAX = 8

/**
 * THE CLOSURES OF A PIXEL, the project's settings for materials built from several closures (a closure tree: `MaterialGraph.slab`,
 * `horizontalMix`, `verticalLayer`, `addClosures`, `weightClosure`, `closures`; a surface without a tree is one closure):
 *
 * - `closuresPerPixel`, 4 — the most closures a material keeps (1 to 8): a material whose tree flattens to more is simplified, the deepest
 *   operators first, each blended into one closure, until it fits;
 * - `closureCountFromMaterial`, on — a view keeps as many closures a pixel as the most any material in view has (up to `closuresPerPixel`);
 *   off, every view keeps `closuresPerPixel`;
 * - `stochasticClosureLighting`, off — how the sampled lighting (`sampledLights`) lights a pixel of several closures: off, it lights every closure and sums
 *   them by their weight; on, it picks ONE closure at random for each pixel, each equally likely, lights that one and divides its light by the chance of the
 *   pick, the denoiser averaging the picks over the frames (cheaper, noisier).
 *
 * Run-time settings, as `./settingRules.ts` says.
 */
export const CLOSURE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('closuresPerPixel', 4, [1, CLOSURES_MAX]),
    flag('closureCountFromMaterial', true),
    flag('stochasticClosureLighting', false),
  ] as const))()

/** The fields of the closure settings. */
export type ClosureField = keyof typeof CLOSURE_RULES

/** What a host writes for the closures of a pixel. */
export type ClosureOptions = SettingOptions<typeof CLOSURE_RULES>

/** The closure setting `field` of a runtime's context (`contextReader`): its default where the context holds none. */
export const readClosureSetting = /* @__PURE__ */ contextReader(CLOSURE_RULES)
