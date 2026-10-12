/** The bits of a 32-bit word that hold an RGBA pixel's alpha byte, the fourth in memory: the high
 *  byte on a little-endian machine, the low one on a big-endian one. */
const ALPHA_BITS = new Uint8Array(Uint32Array.of(0xff).buffer)[0] === 0xff ? 0xff000000 : 0xff

/** RGBA bytes as a `Uint8Array`: one as it is, any other list of bytes copied into one. */
const asBytes = (image: ArrayLike<number>) =>
  image instanceof Uint8Array ? image : Uint8Array.from(image)

/**
 * Comparison of two RGBA images: count of differing pixels, maximum channel error, and RMSE.
 * `alpha: false` sets the alpha channel aside: a pixel differs by its colour alone, and the error
 * and the RMSE are over the three colour channels. A list of bytes that is no `Uint8Array` is
 * compared as one.
 */
export function compareImages(
  imageA: ArrayLike<number>,
  imageB: ArrayLike<number>,
  { alpha = true } = {},
) {
  const [a, b] = [asBytes(imageA), asBytes(imageB)]
  if (!a.length || a.length !== b.length || a.length % 4 !== 0)
    throw new Error('Invalid RGBA images')
  const channels = alpha ? 4 : 3
  let differentPixels = 0,
    maxChannelError = 0,
    squared = 0
  // Both paths give the same result: the aligned one only skips equal pixels four bytes at a time.
  const isAlignedA = (a.byteOffset & 3) === 0
  const isAlignedB = (b.byteOffset & 3) === 0
  if (isAlignedA && isAlignedB) {
    const u32A = new Uint32Array(a.buffer, a.byteOffset, a.length >>> 2)
    const u32B = new Uint32Array(b.buffer, b.byteOffset, b.length >>> 2)
    const compared = alpha ? 0xffffffff : ~ALPHA_BITS
    const pixelCount = u32A.length
    // `p <= pixelCount` would read one past the end, `undefined` on both sides: equal, no pixel added.
    for (let p = 0; p < pixelCount; p++) {
      if (((u32A[p] ^ u32B[p]) & compared) !== 0) {
        differentPixels++
        const i = p << 2
        const d0 = Math.abs(a[i] - b[i])
        const d1 = Math.abs(a[i + 1] - b[i + 1])
        const d2 = Math.abs(a[i + 2] - b[i + 2])
        const d3 = alpha ? Math.abs(a[i + 3] - b[i + 3]) : 0
        squared += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
        maxChannelError = Math.max(maxChannelError, d0, d1, d2, d3)
      }
    }
  } else {
    for (let i = 0; i < a.length; i += 4) {
      let different = false
      for (let c = 0; c < channels; c++) {
        const delta = Math.abs(a[i + c] - b[i + c])
        squared += delta * delta
        maxChannelError = Math.max(maxChannelError, delta)
        different ||= delta !== 0
      }
      if (different) differentPixels++
    }
  }
  return {
    differentPixels,
    maxChannelError,
    rmse: Math.sqrt(squared / ((a.length / 4) * channels)),
  }
}
