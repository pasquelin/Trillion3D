import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { LightingDataFormat } from '../../../../sdk-core/src/contracts/lightingDataFormatOptions.ts'
import { ditherLight, packLight, unpackLight } from './smallFloatWgsl.ts'
import { hasTextureFormatsTier1, TEXTURE_FORMATS_TIER1_WGSL } from './textureFormatsTier.ts'

/**
 * THE FORMAT AN ATLAS OF LIGHT IS STORED IN, from the one setting every family that keeps light between passes reads (`lightingDataFormat`):
 * - `r11g11b10`: the device's own storage format `rg11b10ufloat` where it has `texture-formats-tier1`; else the 11-11-10 word in an `r32uint` texel
 *   (`packLight`, `unpackLight`), which is the same format written by hand — a texel holds the same value either way, the word's
 *   rounding made by the program (`ditherLight`, then `packLight`) in both, so that the native format stores what the word decodes to;
 * - `rgba16`: `rgba16float`; `rgba32`: `rgba32float`, the light stored as it is, no rounding to the 11-11-10 floats' mantissas, so no dither.
 *
 * One source of WGSL for the four: a pass asks for its texel read (`lightOfTexel`), its texel written (`lightTexel`) and its declarations by the
 * format, and `r32uint` writes exactly the text the passes held before the setting existed.
 */
export type LightAtlasFormat = 'r32uint' | 'rg11b10ufloat' | 'rgba16float' | 'rgba32float'

/** The word format, the one every pass held before the setting: what the formats default to. */
export const WORD_LIGHT_FORMAT: LightAtlasFormat = 'r32uint'

/** The format an atlas of light is stored in for the setting `setting` on a device of `features`. */
export const lightAtlasFormat = (
  setting: LightingDataFormat,
  features: { has(name: string): boolean },
): LightAtlasFormat => {
  if (setting === 'rgba32') return 'rgba32float'
  if (setting === 'rgba16') return 'rgba16float'
  return hasTextureFormatsTier1(features) ? 'rg11b10ufloat' : WORD_LIGHT_FORMAT
}

/** The sample type a pass binds an atlas of `format` with: the word is read as an unsigned integer, the others as floats that are only loaded. */
export const lightAtlasSampleType = (format: LightAtlasFormat): GPUTextureSampleType =>
  format === WORD_LIGHT_FORMAT ? 'uint' : 'unfilterable-float'

/** The scalar a sampled atlas of `format` is declared over (`texture_2d<…>`). */
export const lightAtlasScalar = (format: LightAtlasFormat) =>
  format === WORD_LIGHT_FORMAT ? 'u32' : 'f32'

/** The vector a texel of an atlas of `format` is written as. */
export const lightTexelType = (format: LightAtlasFormat) =>
  format === WORD_LIGHT_FORMAT ? 'vec4u' : 'vec4f'

/** The light of the texel `texel` (an expression of a `lightTexelType` vector) of an atlas of `format`. */
export const lightOfTexel = (format: LightAtlasFormat, texel: string) =>
  format === WORD_LIGHT_FORMAT ? `unpackLight(${texel}.r)` : `${texel}.rgb`

/** The light of the texel `at` of the sampled atlas `atlas` of `format`, as a program that loads by level reads it (`textureLoad(atlas,at,0)`): the word's first channel
 *  decoded, the others' three. */
export const lightLoad = (format: LightAtlasFormat, atlas: string, at: string) =>
  format === WORD_LIGHT_FORMAT
    ? `unpackLight(textureLoad(${atlas},${at},0).x)`
    : `textureLoad(${atlas},${at},0).xyz`

/**
 * The texel that stores `light` in an atlas of `format`, rounded as the format rounds it by `dither` (a number of [0, 1)): the word of the light
 * dithered; for the native 11-11-10 format the value that word decodes to, which the hardware stores exactly; for the half and single floats
 * the light itself.
 */
export const lightTexel = (format: LightAtlasFormat, light: string, dither: string) => {
  if (format === WORD_LIGHT_FORMAT)
    return `vec4u(packLight(ditherLight(${light},${dither})),0u,0u,0u)`
  if (format === 'rg11b10ufloat')
    return `vec4f(unpackLight(packLight(ditherLight(${light},${dither}))),1.0)`
  return `vec4f(${light},1.0)`
}

/** The texel that stores `light` in an atlas of `format`, not dithered: the word of the light, for the native 11-11-10 format the value that word decodes to, for the
 *  half and single floats the light itself. */
export const lightTexelPlain = (format: LightAtlasFormat, light: string) => {
  if (format === WORD_LIGHT_FORMAT) return `vec4u(packLight(${light}),0u,0u,0u)`
  if (format === 'rg11b10ufloat') return `vec4f(unpackLight(packLight(${light})),1.0)`
  return `vec4f(${light},1.0)`
}

/** What a program that writes or reads the final texels of `format` beside words it keeps in `r32uint` (the raw atlas, whose second word holds the
 *  distance) declares: the word's functions where the format or the raw atlas needs them, and the language extension the native format needs. */
export const lightAtlasDeps = (format: LightAtlasFormat): WgslDecl[] => {
  if (format === WORD_LIGHT_FORMAT) return [packLight, unpackLight, ditherLight]
  if (format === 'rg11b10ufloat')
    return [TEXTURE_FORMATS_TIER1_WGSL, packLight, unpackLight, ditherLight]
  return [unpackLight]
}

/** What a program that writes texels of `format` (`lightTexel`, `lightTexelPlain`) declares beyond the word's functions the passes of the word format hold:
 *  the native format stores the value the word decodes to, and needs the language extension. */
export const lightStoreDeps = (format: LightAtlasFormat): WgslDecl[] =>
  format === 'rg11b10ufloat' ? [TEXTURE_FORMATS_TIER1_WGSL, packLight, unpackLight] : []

/** What a program that only reads an atlas of `format` declares. */
export const lightReadDeps = (format: LightAtlasFormat): WgslDecl[] =>
  format === WORD_LIGHT_FORMAT ? [unpackLight] : []

/** The entry of a layout `entries` that binds the sampled atlas at `binding`, bound with the sample type its `format` asks. */
export const withLightAtlasEntry = (
  entries: readonly GPUBindGroupLayoutEntry[],
  binding: number,
  format: LightAtlasFormat,
): GPUBindGroupLayoutEntry[] =>
  entries.map((entry) =>
    entry.binding === binding && entry.texture
      ? { ...entry, texture: { ...entry.texture, sampleType: lightAtlasSampleType(format) } }
      : entry,
  )
