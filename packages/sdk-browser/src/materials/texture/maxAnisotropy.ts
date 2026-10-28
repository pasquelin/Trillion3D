/** The most reads anisotropic filtering takes: WebGPU's `maxAnisotropy` ceiling, the most any
 *  device grants. The settings `textureMaxAnisotropy` and `virtualTextureMaxAnisotropy`
 *  (`textureFilteringOptions.ts`) bound it in a run, 8 by default. */
export const MAX_ANISOTROPY = 16
