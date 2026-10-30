import { shippedBytes, sourceBytes, type ByteSource } from '../../../geometry/cluster/shippedBytes.ts'

/**
 * THE TWO CLOUD TEXTURES THAT ARE FILES: the layout pattern and the noise volume, the reference
 * material's own texture data, shipped beside this module. Each file is read once, when the clouds
 * part starts; a read that fails or a file of another size is an error, never replaced by a
 * generated texture. The host may supply the bytes — Node cannot follow a file URL with `fetch`.
 */

/** The pattern's texels along a side. */
export const PATTERN_SIZE = 1024

/** The noise volume's texels along a side. */
export const NOISE_VOLUME_SIZE = 128

/** Bytes of `cloudPattern.bin`: 1024 × 1024 texels of four half floats (little-endian), row after row. */
export const PATTERN_BYTES = PATTERN_SIZE * PATTERN_SIZE * 4 * 2

/** Bytes of `cloudNoise.bin`: 128³ texels of four 8-bit channels, sRGB-encoded, slice after slice and
 *  row after row. */
export const NOISE_VOLUME_BYTES = NOISE_VOLUME_SIZE ** 3 * 4

/** A file's bytes, read once: the cached read, and the bytes it checks. A failed read is asked again
 *  at the next call. */
function fileReader(name: string, bytes: number, resource: () => Promise<BufferSource>) {
  let pending: Promise<Uint8Array> | undefined
  return (source: ByteSource = resource): Promise<Uint8Array> => {
    pending ??= (async () => {
      const read = await sourceBytes(source)
      if (read.length !== bytes)
        throw new RangeError(`the cloud ${name} holds ${read.length} bytes, not ${bytes}`)
      return read
    })().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

/** The layout pattern's bytes (`PATTERN_BYTES`). The file as a page fetches it: beside the module, by its URL. */
export const patternBytes = fileReader('pattern', PATTERN_BYTES, () =>
  shippedBytes(new URL('./cloudPattern.bin', import.meta.url).href),
)

/** The noise volume's bytes (`NOISE_VOLUME_BYTES`). The file as a page fetches it: beside the module, by its URL. */
export const noiseVolumeBytes = fileReader('noise volume', NOISE_VOLUME_BYTES, () =>
  shippedBytes(new URL('./cloudNoise.bin', import.meta.url).href),
)
