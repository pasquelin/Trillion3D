/** A layered texture `texture` as a shader samples it: every layer, one array. */
export const arrayView = (texture: GPUTexture) => texture.createView({ dimension: '2d-array' })

/** The layer `baseArrayLayer` of a layered texture `texture`, alone, as a 2D view. */
export const layerView = (texture: GPUTexture, baseArrayLayer: number) =>
  texture.createView({ dimension: '2d', baseArrayLayer, arrayLayerCount: 1 })

/** Mip `level` of a layered texture `texture`, alone, as a one-level array. */
export const arrayLevelView = (texture: GPUTexture, level: number) =>
  texture.createView({ dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1 })
