import type { TextureFilteringField } from '../contracts/textureFilteringOptions.ts'

/** What each setting of the texture filtering means (`../contracts/textureFilteringOptions.ts`). */
export const TEXTURE_FILTERING_MEANINGS: Readonly<Record<TextureFilteringField, string>> = {
  textureMaxAnisotropy:
    "Most reads anisotropic filtering takes along the longer axis of a footprint, a whole number from 1 to 16, for the clouds' textures, the only ones not streamed by tile (the ceiling of the sampler they are read through); 8 by default (1 at smooth, 2 at balanced, 4 at fine). 1 turns the anisotropic filtering of those textures off. A change is read by the next image.",
  virtualTextureMaxAnisotropy:
    'Most reads anisotropic filtering takes along the longer axis of a footprint for the textures streamed by tile (every map of a material), a whole number from 1 to 16 held to the power of two at or below it; 8 by default (4 at smooth and balanced). A texture that asks for less keeps its own. It bounds the reads of a pixel and the tiles it asks for: a lower value reads fewer taps, picks a coarser level of a surface seen at a grazing angle and streams less, at the cost of sharpness there. A change is read by the next image.',
  virtualTextureAnisotropicFiltering:
    "Whether a texture streamed by tile is read with anisotropic taps: true, as many taps as the footprint's elongation asks along its longer axis, up to virtualTextureMaxAnisotropy, at the level of its shorter axis; false by default (at every quality level), each sample is ONE read at one level, the level of the longer axis moved toward the shorter by the elongation up to the logarithm of virtualTextureMaxAnisotropy, which a per-pixel noise rounds to the level above or below (a raster pass's reads round it to the nearest). One read costs a fraction of the taps, and the tiles a pixel asks for are the level that read takes. A change is read by the next image.",
}
