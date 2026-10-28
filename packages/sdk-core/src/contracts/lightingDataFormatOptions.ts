import { choiceSetting as choice, rulesOf, type SettingOptions } from './settingRules.ts'

/** The formats the light kept between passes is stored at, the reference's lighting data format (0 1 2): 11-11-10 floats (its default), half floats, single floats. */
const LIGHTING_DATA_FORMATS = ['r11g11b10', 'rgba16', 'rgba32'] as const

/** One of the lighting data formats. */
export type LightingDataFormat = (typeof LIGHTING_DATA_FORMATS)[number]

/**
 * THE FORMAT THE LIGHT IS KEPT AT BETWEEN PASSES, one setting every family that stores light reads (the screen probes' filtered radiance, the radiance cache's
 * maps, the translucency volume): `lightingDataFormat`, `r11g11b10` — the reference's default, 11-11-10 floats, four bytes a texel —, `rgba16` half floats
 * (more precision, the light is not rounded to the 11-11-10 floats' mantissas) or `rgba32` single floats. A family with a setting of its own for it
 * (`translucencyGiLightingDataFormat`) follows this one when its own is `global`. Storage as 11-11-10 floats needs the device feature
 * `texture-formats-tier1`; a device without it stores half floats, rounded to the 11-11-10 floats' precision where the format asks it.
 */
export const LIGHTING_DATA_FORMAT_RULES = /* @__PURE__ */ (() =>
  rulesOf([choice('lightingDataFormat', 'r11g11b10', LIGHTING_DATA_FORMATS)] as const))()

/** The fields of the lighting data format's settings. */
export type LightingDataFormatField = keyof typeof LIGHTING_DATA_FORMAT_RULES

/** What a host writes for the lighting data format. */
export type LightingDataFormatOptions = SettingOptions<typeof LIGHTING_DATA_FORMAT_RULES>

/** The format a family stores its light at: its own setting `own`, or the shared one `shared` where its own is `global`. */
export const lightingDataFormatOf = (
  own: LightingDataFormat | 'global',
  shared: LightingDataFormat,
): LightingDataFormat => (own === 'global' ? shared : own)
