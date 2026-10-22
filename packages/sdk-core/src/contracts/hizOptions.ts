import {
  choiceSetting as choice,
  flagSetting as flag,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the depth pyramid (`packages/sdk-browser/src/visibility/hiz/`): what the
 * traces read from it, whether its trace layers hold the transparent surfaces, and how the
 * transparent clusters are tested against it. Run-time settings, as `./settingRules.ts` says. The
 * cut's own occlusion (`cutTwoPassOcclusion`, `./cutOptions.ts`) reads the culling layer, which no
 * setting here changes: it is the opaque depth, farthest, in every mode.
 */

/** How a screen trace reads the pyramid: `'reference'`, the closest depth of the opaque image at
 *  each texel's centre, walked mip by mip; `'planes'`, the engine's own, each pixel a plane going
 *  half its slopes' sum nearer and farther at its edge. */
const HIZ_TRACES = ['reference', 'planes'] as const
/** How a transparent cluster is tested against the culling layer: `'finer'`, over up to sixteen
 *  texels a side of a level fine enough to hold the box's rectangle; `'reference'`, over four
 *  texels a side of the lowest level that holds it. */
const HIZ_TRANSPARENT_TESTS = ['finer', 'reference'] as const

/** The pyramid's settings by field: `hizTrace`, `'reference'` — how the reflections' trace reads
 *  the pyramid —; `hizFoldTransparents`, off — whether the trace layers hold the nearest
 *  transparent surface of each pixel beside the opaque depth —; `hizTransparentTest`, `'finer'` —
 *  how the transparent clusters are tested. */
export const HIZ_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('hizTrace', 'reference', HIZ_TRACES),
    flag('hizFoldTransparents', false),
    choice('hizTransparentTest', 'finer', HIZ_TRANSPARENT_TESTS),
  ] as const))()
/** The field of one setting of the pyramid. */
export type HizField = keyof typeof HIZ_RULES
/** The pyramid's settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type HizOptions = SettingOptions<typeof HIZ_RULES>
