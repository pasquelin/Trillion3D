import {
  ANY_NUMBER as ANY,
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  contextReader,
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
 * `hizFullResDepth` is read by the screen probes' trace alone; and
 * `lightGridHizCull`, `lightGridLinkedLists` and `lightGridMaxCulledLightsPerCell` are read by the light grid's pass (`packages/sdk-browser/src/lighting/tiles/`),
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

/** The shifts the primed draw's size takes: the image's size shifted right by one more than the
 *  bias, so a bias from 0 to 30 — a shift is a whole number of bits of a 32-bit word, and the
 *  reference clamps a lower bias to 0. */
const PRIME_SIZE_BIASES: readonly [number, number] = [0, 30]

/** The words a cell of the view's light grid may hold, whole numbers from 1 to 1024: the pool of
 *  the view's grid is its cells times this. */
const MAX_CULLED_LIGHTS_PER_CELL: readonly [number, number] = [1, 1024]

/** The pyramid's settings by field: `hizTrace`, `'reference'` — how the reflections' trace reads
 *  the pyramid —; `hizFoldTransparents`, off — whether the trace layers hold the nearest
 *  transparent surface of each pixel beside the opaque depth —; `hizTransparentTest`, `'finer'` —
 *  how the transparent clusters are tested —; `hizFullResDepth`, on — whether the screen probes' `'reference'` walk goes down to the
 *  full-resolution depth, else it stops at the half-resolution level, the reflections' always going
 *  down —; `lightGridHizCull`, on — whether the light grid leaves empty the cells behind the
 *  farthest depth of their column of the image; `lightGridLinkedLists`, on — whether the cells'
 *  lists are made from chains of links taken from one pool, else each cell has its share of it;
 *  `lightGridMaxCulledLightsPerCell`, 32 — the light entries the view's light grid holds per cell, the
 *  pool being its cells times this, the lights asked past it dropped; `hizPrime`, `'off'` — when the primed pyramid is built
 *  —; `hizPrimeSizeBias`, 2 — the primed draw is the image's size shifted right by one more than this —;
 *  `hizPrimeDepthBias`, 1.5 — metres its depth is pushed away from the eye by —; `hizPrimeErrorScale`,
 *  32 — the factor on the cut's pixel error, so the clusters drawn are that much coarser —;
 *  `hizPrimeFarFieldOnly`, on — whether the primed draw holds the objects that set `farField` alone. */
export const HIZ_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('hizTrace', 'reference', HIZ_TRACES),
    flag('hizFoldTransparents', false),
    choice('hizTransparentTest', 'finer', HIZ_TRANSPARENT_TESTS),
    flag('hizFullResDepth', true),
    flag('lightGridHizCull', true),
    flag('lightGridLinkedLists', true),
    integer('lightGridMaxCulledLightsPerCell', 32, MAX_CULLED_LIGHTS_PER_CELL),
    choice('hizPrime', 'off', HIZ_PRIMES),
    integer('hizPrimeSizeBias', 2, PRIME_SIZE_BIASES),
    number('hizPrimeDepthBias', 1.5, ANY),
    number('hizPrimeErrorScale', 32, ANY),
    flag('hizPrimeFarFieldOnly', true),
  ] as const))()
/** The depth pyramid setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readHizSetting = /* @__PURE__ */ contextReader(HIZ_RULES)
/** The field of one setting of the pyramid. */
export type HizField = keyof typeof HIZ_RULES
/** The pyramid's settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type HizOptions = SettingOptions<typeof HIZ_RULES>
