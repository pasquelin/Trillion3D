/** A layered texture `texture` as a shader samples it: every layer, one array. */
export const arrayView = (texture: GPUTexture) => texture.createView({ dimension: '2d-array' });
