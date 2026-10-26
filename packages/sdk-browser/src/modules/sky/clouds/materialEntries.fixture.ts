// The seven bindings of the cloud material's group (`cloudMaterialLayoutEntries`) over the kit's device:
// its block, its three-dimensional noise and lightning volumes, its three images and its sampler.

/** A buffer of `usage` on `device`, and the material's entries from binding 0. */
export function materialEntries(device: GPUDevice) {
  const buffer = (usage: number) => device.createBuffer({ size: 4096, usage })
  const view = (dimension: GPUTextureDimension = '2d') =>
    device
      .createTexture({
        size: { width: 4, height: 4, depthOrArrayLayers: dimension === '3d' ? 4 : 1 },
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
        dimension,
      })
      .createView({ dimension })
  const material: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: buffer(GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST) } },
    { binding: 1, resource: view('3d') },
    { binding: 2, resource: view() },
    { binding: 3, resource: view() },
    { binding: 4, resource: view() },
    { binding: 5, resource: view('3d') },
    { binding: 6, resource: device.createSampler() },
  ]
  return { buffer, material }
}
