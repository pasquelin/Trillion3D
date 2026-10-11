import { createReadbackRing } from '../gpu/core/readbackRing.ts'

/** Bytes of the hash: the lit image's two words, then the image before it's. */
export const RADIANCE_HASH_BYTES = 16
/** Bytes of a sample: the hash, then the count of tiles the trace listed that image. */
export const SAMPLE_BYTES = RADIANCE_HASH_BYTES + 4
/** Samples in flight at most: an image's copy waits for none, and takes none when all are in flight. */
const SAMPLES = 3

/**
 * The samples of the hash, read back without a wait: a ring of staging buffers, each filled by a
 * copy in the image's commands, mapped once that image is submitted (`submitted`), and answering
 * `answer` with the words it holds and the image they are of some frames later.
 */
function createSampleRing(device: GPUDevice, answer: (image: number, words: Uint32Array) => void) {
  const ring = createReadbackRing(
    device,
    {
      label: 'Trillion3D reflection radiance hash sample',
      bytes: SAMPLE_BYTES,
      count: SAMPLES,
      eager: true,
    },
    (mapped, _staging, image) => answer(image, new Uint32Array(mapped, 0, SAMPLE_BYTES / 4)),
  )
  return {
    /** Copies the hash and the count of tiles into a free sample, for `image`. */
    copy(encoder: GPUCommandEncoder, hash: GPUBuffer, tiles: GPUBuffer, image: number) {
      // A copy still waiting for its submission is an abandoned image's: its commands never ran.
      const sample = ring.take(image)
      if (!sample) return
      encoder.copyBufferToBuffer(hash, 0, sample, 0, RADIANCE_HASH_BYTES)
      encoder.copyBufferToBuffer(tiles, 12, sample, RADIANCE_HASH_BYTES, 4)
    },
    /** The image is submitted: its copies are mapped, and answer when the GPU has run them. */
    submitted: ring.submitted,
    dispose: ring.destroy,
  }
}

/**
 * WHEN THE REFLECTIONS HAVE SETTLED. An image reflects the lit image before it, so a view that
 * stands still is not final while the lit image still changes — a light edited, a shadow arriving,
 * a particle passing —: the image drawn from it would not be the one the next draws. A radiance
 * pyramid knows it for free: the first dispatch of its build folds the lit image into a 64-bit hash
 * beside the previous image's (`radianceRoll`), and an image whose two hashes are equal has the
 * same lit image as the one before. The hash is read back, 20 bytes with the count of tiles the
 * trace listed that image, while the view is not settled — one copy an image, each mapped once its
 * image is submitted, none ever waited for: the answer comes some images later, and until then the
 * view is unsettled. An image whose trace listed no tile reflects nothing (the trace's target is
 * read by no pixel): its lit image is no matter to the reflections, and the view is settled by its
 * own stillness.
 *
 * The view is settled once an image after the last one drawn for another reason — `busy` marks the
 * image about to be drawn for the lighting's, the cut's, the pages' own pending work — has the
 * hash of the image before it (`verified`): both images lie after the last change, so the lit
 * image is final and the next image reflects what this one did. A still view's lit image is
 * deterministic — the shadows' noise turns with the temporal accumulation's phase alone
 * (`stochasticPhase`) —, so it repeats within a few images, the reflection of the screen being a
 * geometric series of a share under one. No image is ever sampled once the view is settled.
 */
export function createRadianceSettle(device: GPUDevice) {
  const hash = device.createBuffer({
    label: 'Trillion3D reflection radiance hash',
    size: RADIANCE_HASH_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  let images = 0,
    busy = 0,
    equal = 0
  // A sample's answer: its image's hash is the one before it's, or it listed no tile.
  const samples = createSampleRing(device, (image, words) => {
    if ((words[0] === words[2] && words[1] === words[3]) || words[4] === 0)
      equal = Math.max(equal, image)
  })
  return {
    hash,
    /** An image is drawn, its radiance pyramid encoded: counted, and, while the view is not
     *  settled, its hash and the count of tiles the trace listed (the fourth word of `tiles`, its
     *  indirect arguments) copied, to be mapped once the image is submitted (`submitted`). */
    image(encoder: GPUCommandEncoder, tiles: GPUBuffer) {
      images++
      if (!this.verified) samples.copy(encoder, hash, tiles, images)
    },
    /** The image about to be drawn is drawn for another reason than the reflections'. */
    busy() {
      busy = images + 1
    },
    /** Whether an image after the last busy one has the lit image of the one before it. */
    get verified() {
      return equal > busy
    },
    /** The image is submitted: its copies are mapped. */
    submitted: samples.submitted,
    dispose() {
      hash.destroy()
      samples.dispose()
    },
  }
}
