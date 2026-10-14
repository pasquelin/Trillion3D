/**
 * The engine's one stand-in texture: what a program binds where its real texture does not exist
 * yet and no pixel reads it — `side` × `side` texels of `format`, sampled only, at zero. Given
 * `fill`, every byte of it is `fill` (a format of four bytes a texel): the white a tile pool lane
 * without layers samples.
 */
export function standInTexture(
  device: GPUDevice,
  label: string,
  format: GPUTextureFormat,
  { side = 1, fill }: { side?: number; fill?: number } = {},
) {
  const copied = fill === undefined ? 0 : GPUTextureUsage.COPY_DST
  const texture = device.createTexture({
    label,
    size: [side, side, 1],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | copied,
  })
  if (fill !== undefined) {
    const bytes = new Uint8Array(side * side * 4).fill(fill)
    device.queue.writeTexture({ texture }, bytes, { bytesPerRow: side * 4 }, [side, side])
  }
  return texture
}
