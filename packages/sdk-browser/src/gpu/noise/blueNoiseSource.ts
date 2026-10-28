import type { NoiseVolume } from '../../../../math/src/sequence/noiseEnergy.ts'
import { shippedBytes, sourceBytes, type ByteSource } from '../../geometry/cluster/shippedBytes.ts'

/**
 * THE ENGINE'S BLUE NOISE, as the file it ships in: a spatiotemporal mask of 128 × 128 pixels and 64 frames, one value a pixel
 * (a scalar mask, from the void-and-cluster method) and a pair of values a pixel (a vector mask, by simulated annealing), the
 * passes' random numbers — each blue in every image and along the frames, so that a pass that reads a pixel's number
 * at each frame, and a pass that filters the images, meet noise a filter takes out easily (`scripts/dev/blue-noise.ts`
 * makes the file, `packages/math/src/sequence/noiseEnergy.ts` says how).
 *
 * The file is the scalar mask's `128 × 128 × 64` bytes, frame after frame and row after row, then the vector mask's, two bytes a
 * pixel. A mask is read as one texture of 128 × 8192 texels, the frame `z` of the pixel `(x, y)` at texel `(x, z · 128 + y)`.
 */

/** The sizes of the masks: the pixels along an image's sides, and the frames. */
export const BLUE_NOISE_VOLUME: NoiseVolume = { width: 128, height: 128, depth: 64 }

/** Pixels in a mask. */
export const BLUE_NOISE_PIXELS =
  BLUE_NOISE_VOLUME.width * BLUE_NOISE_VOLUME.height * BLUE_NOISE_VOLUME.depth

/** Bytes of the file: the scalar mask's, and the vector mask's two for each pixel. */
export const BLUE_NOISE_BYTES = BLUE_NOISE_PIXELS * 3

let pending: Promise<Uint8Array> | undefined
let loaded: Uint8Array | undefined

/** The file as a page fetches it: beside the module, by its URL. */
const resource = () => shippedBytes(new URL('./blueNoise.bin', import.meta.url).href)

/** The file's bytes, read once; a failed read is asked again at the next call. The host may supply the bytes — that is what Node does,
 *  which cannot follow a file URL with `fetch`. */
export function blueNoiseBytes(source: ByteSource = resource): Promise<Uint8Array> {
  pending ??= (async () => {
    const bytes = await sourceBytes(source)
    if (bytes.length !== BLUE_NOISE_BYTES)
      throw new RangeError(`the blue noise holds ${bytes.length} bytes, not ${BLUE_NOISE_BYTES}`)
    return (loaded = bytes)
  })().catch((error: unknown) => {
    pending = undefined
    throw error
  })
  return pending
}

/** The file's bytes if they were read, else none: a second device makes its textures from them at once. */
export const loadedBlueNoiseBytes = () => loaded
