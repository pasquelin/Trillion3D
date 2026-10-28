import {
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  rulesOf,
  type SettingOptions,
  type SettingRange,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE RUN-TIME TEXTURE FILTERING (`packages/sdk-browser/src/materials/texture/`): the most reads
 * anisotropic filtering takes along the longer axis of a footprint, for the textures the engine
 * streams by tile (`virtualTextureMaxAnisotropy`) and for the clouds' textures, the only ones read
 * through a sampler of their own (`textureMaxAnisotropy`). Run-time settings, as `./settingRules.ts` says: no compiler job
 * names them and no cache key holds them. A texture that asks less (`Texture.anisotropy`) keeps
 * its own, and one that asks more is held to these.
 *
 * A streamed texture's ceiling bounds both what a pixel reads and what it asks to stream: the
 * reads along the footprint and the level they are taken at (the longer axis divided by the reads)
 * are the request's too, so a lower ceiling reads fewer taps and asks for coarser tiles on a
 * surface seen at a grazing angle. It is held to a power of two, 1 to 16, the reference taking the
 * logarithm of the value to bound the elongation it undoes in the level; a value in between reads
 * as the power of two below it. How the streamed textures read along the footprint is
 * `virtualTextureAnisotropicFiltering`: off, the default, each sample is ONE read at one level, the level
 * of the footprint's longer axis moved toward the shorter by the elongation, up to the ceiling's
 * logarithm, and picked among the two levels it straddles by a noise that changes each pixel and
 * image (the reads of a raster pass, and of a pixel nothing speaks for, round it); on, the reads are
 * as many taps as the elongation asks, up to the ceiling, along the axis. The request follows the
 * read in both. The clouds' textures' ceiling is the sampler's own `maxAnisotropy`,
 * any whole number from 1 to 16, the device's limit. A change is read by the next image: the
 * streamed textures' headers are written again, the samplers made again.
 */

/** The ceilings a whole number takes: 1 (one read, no anisotropic filtering) to 16, the most a
 *  device grants. */
const ANISOTROPY: SettingRange = [1, 16]

/** The texture filtering's settings by field, each with the reference's default at its top
 *  scalability level: `textureMaxAnisotropy`, 8 — the sampler's ceiling of the textures not
 *  streamed by tile —; `virtualTextureMaxAnisotropy`, 8 — the ceiling of the streamed textures'
 *  reads and requests —; `virtualTextureAnisotropicFiltering`, off — whether a streamed texture's
 *  sample is the taps along the footprint (on) or one read at the level the elongation moves
 *  (off), the same at every quality level. */
export const TEXTURE_FILTERING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('textureMaxAnisotropy', 8, ANISOTROPY),
    integer('virtualTextureMaxAnisotropy', 8, ANISOTROPY),
    flag('virtualTextureAnisotropicFiltering', false),
  ] as const))()
/** The texture filtering setting `field` of a runtime's context (`contextReader`): its default
 *  where the context holds none. */
export const readTextureFilteringSetting = /* @__PURE__ */ contextReader(TEXTURE_FILTERING_RULES)
/** The field of one texture filtering setting. */
export type TextureFilteringField = keyof typeof TEXTURE_FILTERING_RULES
/** The texture filtering's settings as a host writes them: each its value, or nothing for its
 *  default. */
export type TextureFilteringOptions = SettingOptions<typeof TEXTURE_FILTERING_RULES>
/** The texture filtering's settings with every field set. */
export type TextureFilteringValues = SettingValues<typeof TEXTURE_FILTERING_RULES>

/** What each quality preset below the top writes, the reference's texture quality rows 0 to 2 —
 *  the sampler's ceiling 1, 2 and 4, the streamed textures' 4, 4 and 8; the top row and the
 *  cinematic one hold 8 and 8, the defaults, and write nothing (`runtime/qualityLevels.ts`). */
export const TEXTURE_FILTERING_PRESET_LEVELS = {
  smooth: { textureMaxAnisotropy: 1, virtualTextureMaxAnisotropy: 4 },
  balanced: { textureMaxAnisotropy: 2, virtualTextureMaxAnisotropy: 4 },
  fine: { textureMaxAnisotropy: 4, virtualTextureMaxAnisotropy: 8 },
  cinematic: {},
} as const satisfies Record<string, Partial<TextureFilteringValues>>

/** The ceiling a streamed texture is held to: the greatest power of two the setting holds. */
export const streamedAnisotropyCeiling = (setting: number) =>
  1 << (31 - Math.clz32(Math.max(1, Math.floor(setting))))
