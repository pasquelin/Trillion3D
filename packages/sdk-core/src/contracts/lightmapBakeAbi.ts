/**
 * The compiler's bake of the volumetric lightmap (`volumetricLightmapFile.ts` reads what it
 * writes), written once as rules (`settingRules.ts`) and read by the job's resolver, the options
 * schema and the compiler's Rust (`scripts/build/shared-rules/lightmapBake.ts`). The job field
 * `lightmapBake` is `true` (the defaults), `false` or none (no bake), or an object of the
 * settings below, each left out for its default — the reference's. The reference's own lengths
 * are in centimetres; ours are metres.
 *
 * - `detailCellSize`: the size of a cell of the finest level, in metres (2: the reference's
 *   200 cm); halving it can multiply the memory by up to eight.
 * - `qualityMultiplier`: the multiple of `giSamples` the volume's probes take (4).
 * - `giSamples`: the paths a probe takes for a unit of quality (512).
 * - `maxRefinementLevels`: the levels of bricks, 1 to 4 (3): the file names a brick's span in
 *   a byte, so a fifth level does not fit.
 * - `irradianceCaching`: whether paths end in a cache of the radiance leaving a surface after
 *   a first bounce (`true`); it brightens interiors and biases a little.
 * - `irradianceCacheQuality`: the passes that build the cache (128).
 * - `irradianceCacheSpacing`: the size of a cache cell, in metres (0.32).
 * - `irradianceCacheCornerRejection`: how near a hit may be, in spacings, for the cache to be
 *   read there (1).
 * - `automaticVolumeExpand`: how far the scene's box grows, in metres, when no volume is named
 *   (5: the reference's 500 cm), so that probes on its surfaces lie inside.
 * - `automaticVolumeLimit`: the half-size, in metres, past which the scene's box is cut to a cube
 *   of that half-size around its centre (100: the reference's 10000 cm).
 * - `maximumBrickMemory`: the memory, in megabytes, the bricks of the finest level may take (30):
 *   past it the finest bricks furthest from the geometry are dropped, and the coarser brick over
 *   them lights where they were. It holds where the volume is one piece (`loadingCellSize` 0);
 *   cut in cells (the default) the bricks stream, and the run-time setting
 *   `volumetricLightmapBrickMemory` bounds what stays resident.
 * - `sphericalHarmonicSmoothing`: how much the spherical harmonics of a sample are smoothed where
 *   highly directional light rings them into black areas on the far side, 0 none to 1 strong
 *   (0.02); the smoothing is only applied where the ringing is.
 * - `loadingCellSize`: the size, in metres, of a cell of the grid the finest bricks stream by
 *   (32: the reference's 3200 cm); the coarser bricks are always loaded. A multiple of a finest
 *   brick's side (4 detail cells), rounded to the nearest; 0 keeps the volume in one piece, and the
 *   memory limit trims it.
 * - `minBrickError`: the error, as the root mean square of the ambient light, under which a finest
 *   brick is dropped because the brick over it interpolates it (0.01).
 * - `volumes`: the boxes the volume covers, each a lower then an upper corner in metres; none,
 *   the scene's own (see the two settings above).
 * - `skyLight`: the stationary sky light the bake shines — `true` its defaults, `false` or none
 *   no sky, or an object of the settings below. A compile job holds no captured sky, so the sky
 *   is a flat one: a cube of one over the horizon and the lower hemisphere's colour under it,
 *   times the colour and the intensity. It lights the bounces as every light of the bake does (the
 *   engine draws its direct light itself) and, where it casts shadows, fills the layer of the sky's
 *   bent normal, whose length is the sky's visibility there. No sky, no bent normal in the file.
 */
import { SKY_LIGHT_RULES } from '../modules/sky/skyLight.ts'
import {
  atLeast,
  flagSetting,
  integerSetting,
  numberSetting,
  positiveSetting,
  ruleFields,
  rulesOf,
} from './settingRules.ts'

/** The job field naming the bake and the command line's flag holding it as JSON. */
export const LIGHTMAP_BAKE_FIELD = 'lightmapBake'
export const LIGHTMAP_BAKE_OPTION = '--lightmap-bake='
/** The key of the boxes the volume covers. */
export const LIGHTMAP_BAKE_VOLUMES = 'volumes'
/** The key of the sky light the bake shines. */
export const LIGHTMAP_BAKE_SKY = 'skyLight'
/** The product holding the baked lightmap, and the manifest's section naming it. */
export const LIGHTMAP_BAKE_FILE = 'volumetric-lightmap.bin'
/** The reference's length unit per metre, which its sizes are written in. */
export const LIGHTMAP_BAKE_UNITS_PER_METRE = 100

/** The bake's settings with their defaults, the reference's. */
export const LIGHTMAP_BAKE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    numberSetting('detailCellSize', 2, [0.01, 200]),
    integerSetting('qualityMultiplier', 4, [1, 256]),
    integerSetting('giSamples', 512, [32, 65536]),
    integerSetting('maxRefinementLevels', 3, [1, 4]),
    flagSetting('irradianceCaching', true),
    integerSetting('irradianceCacheQuality', 128, [4, 65536]),
    numberSetting('irradianceCacheSpacing', 0.32, [0.04, 10.24]),
    numberSetting('irradianceCacheCornerRejection', 1, [0, 8]),
    numberSetting('automaticVolumeExpand', 5, atLeast(0)),
    positiveSetting('automaticVolumeLimit', 100, 'a number above 0'),
    numberSetting('maximumBrickMemory', 30, [1, 65536]),
    numberSetting('sphericalHarmonicSmoothing', 0.02, [0, 1000]),
    numberSetting('loadingCellSize', 32, [0, 100000]),
    numberSetting('minBrickError', 0.01, [0, 1000]),
  ]))()

/** The fields of `LIGHTMAP_BAKE_RULES`, in order. */
export const LIGHTMAP_BAKE_SETTINGS = /* @__PURE__ */ ruleFields(LIGHTMAP_BAKE_RULES)

/** The sky light's settings the bake reads: the sky light part's own rules (`SKY_LIGHT_RULES`, a white
 *  sky of intensity 1 over a black lower hemisphere, casting shadows). A colour is linear, and the
 *  sky's radiance — the cube times the colour times the intensity — is held at 0 or more. */
export const LIGHTMAP_BAKE_SKY_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    SKY_LIGHT_RULES.intensity,
    SKY_LIGHT_RULES.color,
    SKY_LIGHT_RULES.lowerHemisphereColor,
    SKY_LIGHT_RULES.castShadows,
  ]))()

/** The fields of `LIGHTMAP_BAKE_SKY_RULES`, in order. */
export const LIGHTMAP_BAKE_SKY_SETTINGS = /* @__PURE__ */ ruleFields(LIGHTMAP_BAKE_SKY_RULES)

/** The sky light's settings as the compiler reads them, each left out when not named. */
export type LightmapBakeSky = {
  intensity?: number
  color?: readonly [number, number, number]
  lowerHemisphereColor?: readonly [number, number, number]
  castShadows?: boolean
}

/** A box of the volume: lower then upper corner, in metres. */
export type LightmapBakeVolume = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
]

/** The bake's settings as the compiler reads them, each left out when not named. */
export type LightmapBakeWire = {
  detailCellSize?: number
  qualityMultiplier?: number
  giSamples?: number
  maxRefinementLevels?: number
  irradianceCaching?: boolean
  irradianceCacheQuality?: number
  irradianceCacheSpacing?: number
  irradianceCacheCornerRejection?: number
  automaticVolumeExpand?: number
  automaticVolumeLimit?: number
  maximumBrickMemory?: number
  sphericalHarmonicSmoothing?: number
  loadingCellSize?: number
  minBrickError?: number
  volumes?: readonly LightmapBakeVolume[]
  skyLight?: boolean | LightmapBakeSky
}

/** The job's `lightmapBake`: `true` the defaults, `false` no bake, or the settings. */
export type LightmapBakeOption = boolean | LightmapBakeWire
