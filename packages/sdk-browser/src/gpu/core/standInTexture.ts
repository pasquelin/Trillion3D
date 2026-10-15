import { texelBytesOf } from './textureBytes.ts'

/**
 * The engine's one stand-in texture: what a program binds where its real texture does not exist
 * yet and no pixel reads it — `side` × `side` texels of `format`, sampled only, at zero. Given
 * `fill`, every byte of it is `fill`: the white a tile pool lane
 * without layers samples.
 */
export function standInTexture(
  device: Pick<GPUDevice, 'createTexture' | 'queue'>,
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
    const row = side * texelBytesOf(format)
    const bytes = new Uint8Array(side * row).fill(fill)
    device.queue.writeTexture({ texture }, bytes, { bytesPerRow: row }, [side, side])
  }
  return texture
}
