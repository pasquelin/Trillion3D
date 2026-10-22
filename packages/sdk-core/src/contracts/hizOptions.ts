import {
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the depth pyramid (`packages/sdk-browser/src/visibility/hiz/`): what the
 * traces read from it, whether its trace layers hold the transparent surfaces, and how the
 * transparent clusters are tested against it. Run-time settings, as `./settingRules.ts` says. The
 * cut's own occlusion (`cutTwoPassOcclusion`, `./cutOptions.ts`) reads the culling layer, which no
 * setting here changes: it is the opaque depth, farthest, in every mode.
 *
 * `hizRelativeDepthThickness` belongs to the `'reference'` walk of `hizTrace`, read by the
 * reflections' trace; `hizFullResDepth` is read by the screen probes' trace alone; and
 * `lightGridHizCull` is read by the light grid's pass (`packages/sdk-browser/src/lighting/tiles/`),
 * which reads the culling layer too. The five `hizPrime…` settings belong to the primed pyramid
 * (`packages/sdk-browser/src/frame/render/primeHiz.ts`): a pyramid built before the cut's main
 * pass from a coarse, small draw of the flagged objects, which the main pass tests against when
 * the previous image left none.
 */

/** How a screen trace reads the pyramid: `'reference'`, the closest depth of the opaque image at
 *  each texel's centre, walked mip by mip; `'planes'`, the engine's own, each pixel a plane going
 *  half its slopes' sum nearer and farther at its edge. */
const HIZ_TRACES = ['reference', 'planes'] as const
/** How a transparent cluster is tested against the culling layer: `'finer'`, over up to sixteen
 *  texels a side of a level fine enough to hold the box's rectangle; `'reference'`, over four
 *  texels a side of the lowest level that holds it. */
const HIZ_TRANSPARENT_TESTS = ['finer', 'reference'] as const
/** When the primed pyramid is built: never; `'whenMissing'`, for an image whose view has no
 *  pyramid of the image before (its first, a resize, a cut of the camera); `'always'`, for every
 *  image. */
const HIZ_PRIMES = ['whenMissing', 'always', 'off'] as const

/** The pyramid's settings by field: `hizTrace`, `'reference'` — how the reflections' trace reads
 *  the pyramid —; `hizFoldTransparents`, off — whether the trace layers hold the nearest
 *  transparent surface of each pixel beside the opaque depth —; `hizTransparentTest`, `'finer'` —
 *  how the transparent clusters are tested —; `hizRelativeDepthThickness`, 0.005 — the thickness
 *  the reflections' `'reference'` walk gives a surface, a share of the surface's depth, times the
 *  projection's scale (1 under a perspective); the `'planes'` walk keeps its pixels' thickness —;
 *  `hizFullResDepth`, on — whether the screen probes' `'reference'` walk goes down to the
 *  full-resolution depth, else it stops at the half-resolution level, the reflections' always going
 *  down —; `lightGridHizCull`, on — whether the light grid leaves empty the cells behind the
 *  farthest depth of their column of the image; `hizPrime`, `'off'` — when the primed pyramid is built
 *  —; `hizPrimeSizeBias`, 2 — the primed draw is the image's size shifted right by one more than this —;
 *  `hizPrimeDepthBias`, 1.5 — metres its depth is pushed away from the eye by —; `hizPrimeErrorScale`,
 *  32 — the factor on the cut's pixel error, so the clusters drawn are that much coarser —;
 *  `hizPrimeFarFieldOnly`, on — whether the primed draw holds the objects that set `farField` alone. */
export const HIZ_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('hizTrace', 'reference', HIZ_TRACES),
    flag('hizFoldTransparents', false),
    choice('hizTransparentTest', 'finer', HIZ_TRANSPARENT_TESTS),
    nonNegative('hizRelativeDepthThickness', 0.005),
    flag('hizFullResDepth', true),
    flag('lightGridHizCull', true),
    choice('hizPrime', 'off', HIZ_PRIMES),
    integer('hizPrimeSizeBias', 2, [0, 8]),
    nonNegative('hizPrimeDepthBias', 1.5),
    positive('hizPrimeErrorScale', 32, 'a finite number above zero'),
    flag('hizPrimeFarFieldOnly', true),
  ] as const))()
/** The field of one setting of the pyramid. */
export type HizField = keyof typeof HIZ_RULES
/** The pyramid's settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type HizOptions = SettingOptions<typeof HIZ_RULES>
