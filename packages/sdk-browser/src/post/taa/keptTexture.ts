/** The texture of `descriptor`, kept in `kept` until the targets that own it are retired. */
export function keptTexture(
  device: GPUDevice,
  kept: GPUTexture[],
  descriptor: GPUTextureDescriptor,
) {
  const texture = device.createTexture(descriptor)
  kept.push(texture)
  return texture
}
