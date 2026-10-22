import { texelBytesOf } from './textureBytes.ts'

/**
 * The engine's one stand-in texture: what a program binds where its real texture does not exist
 * yet and no pixel reads it — `side` × `side` texels of `format`, `layers` of them (the depth of a
 * `'3d'` `dimension`), sampled only, at zero; bound as storage too with `storage`, where a
 * program's store of it is folded away. Given
 * `fill`, every byte of its first layer is `fill`: the white a tile pool lane without layers
 * samples.
 */
export function standInTexture(
  device: Pick<GPUDevice, 'createTexture' | 'queue'>,
  label: string,
  format: GPUTextureFormat,
  {
    side = 1,
    layers = 1,
    fill,
    storage = false,
    dimension = '2d',
  }: {
    side?: number
    layers?: number
    fill?: number
    storage?: boolean
    dimension?: GPUTextureDimension
  } = {},
) {
  const copied = fill === undefined ? 0 : GPUTextureUsage.COPY_DST
  const texture = device.createTexture({
    label,
    size: [side, side, layers],
    dimension,
    format,
    usage:
      GPUTextureUsage.TEXTURE_BINDING | copied | (storage ? GPUTextureUsage.STORAGE_BINDING : 0),
  })
  if (fill !== undefined) {
    const row = side * texelBytesOf(format)
    const bytes = new Uint8Array(side * row).fill(fill)
    device.queue.writeTexture({ texture }, bytes, { bytesPerRow: row }, [side, side])
  }
  return texture
}
