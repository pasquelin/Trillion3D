/** WebGPU's guaranteed `maxTextureDimension2D`, the side every device grants a target. The
 *  reference plans its tiles on it, not on the device's own limit: a reference is the same image,
 *  at the same factor and tiling, on every machine. Elsewhere it stands only for a device that
 *  names no limits; a real device's granted side bounds the atlases (`textureLimits`). */
export const GUARANTEED_SIDE = 8192
/** WebGPU's guaranteed `maxTextureArrayLayers`, the layers every device grants an array. */
const PORTABLE_TEXTURE_LAYERS = 256

/** The texture limits a device of `limits` grants — the widest side and the most array layers —,
 *  WebGPU's guaranteed ones for any it does not name: the one reader of the device's texture
 *  limits, so every atlas and pool is bounded alike. */
export const textureLimits = (limits?: {
  maxTextureDimension2D?: number
  maxTextureArrayLayers?: number
}) => ({
  side: limits?.maxTextureDimension2D ?? GUARANTEED_SIDE,
  layers: limits?.maxTextureArrayLayers ?? PORTABLE_TEXTURE_LAYERS,
})
