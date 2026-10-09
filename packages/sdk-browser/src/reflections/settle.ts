import { mapRead } from '../gpu/core/periodicReadback.ts'

/** Bytes of the hash: the lit image's two words, then the image before it's. */
export const RADIANCE_HASH_BYTES = 16
/** Bytes of a sample: the hash, then the count of tiles the trace listed that image. */
export const SAMPLE_BYTES = RADIANCE_HASH_BYTES + 4
/** The images drawn after the last busy one that the lit image has to repeat in: past them the view
 *  is settled as it stands. A lit image that never repeats — shadows that speckle from one image to
 *  the next, a particle that does not stop — has no fixed point to wait for, and the reflections of
 *  it are as converged as they will be; one that repeats does so within a few images, the
 *  reflection of the screen being a geometric series of a share under one. */
const SETTLE_IMAGES = 16
/** Samples in flight at most: an image's copy waits for none, the oldest of the ring is reused. */
const SAMPLES = 3

type Sample = { buffer: GPUBuffer; image: number; state: 'free' | 'copied' | 'mapping' }

/**
 * The samples of the hash, read back without a wait: a ring of staging buffers, each filled by a
 * copy in the image's commands, mapped once that image is submitted (`submitted`), and answering
 * `answer` with the words it holds and the image they are of some frames later.
 */
function createSampleRing(device: GPUDevice, answer: (image: number, words: Uint32Array) => void) {
  const ring: Sample[] = Array.from({ length: SAMPLES }, () => ({
    buffer: device.createBuffer({
      label: 'Trillion3D reflection radiance hash sample',
      size: SAMPLE_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
    image: 0,
    state: 'free',
  }))
  let disposed = false
  return {
    /** Copies the hash and the count of tiles into a free sample, for `image`. */
    copy(encoder: GPUCommandEncoder, hash: GPUBuffer, tiles: GPUBuffer, image: number) {
      // A copy still waiting for its submission is an abandoned image's: its commands never ran.
      for (const stale of ring) if (stale.state === 'copied') stale.state = 'free'
      const sample = ring.find((candidate) => candidate.state === 'free')
      if (!sample || disposed) return
      encoder.copyBufferToBuffer(hash, 0, sample.buffer, 0, RADIANCE_HASH_BYTES)
      encoder.copyBufferToBuffer(tiles, 12, sample.buffer, RADIANCE_HASH_BYTES, 4)
      sample.image = image
      sample.state = 'copied'
    },
    /** The image is submitted: its copies are mapped, and answer when the GPU has run them. */
    submitted() {
      for (const sample of ring) {
        if (sample.state !== 'copied' || disposed) continue
        sample.state = 'mapping'
        Promise.resolve(sample.buffer.mapAsync(mapRead(), 0, SAMPLE_BYTES))
          .then(() => {
            if (!disposed)
              answer(sample.image, new Uint32Array(sample.buffer.getMappedRange(0, SAMPLE_BYTES)))
          })
          .catch(() => {})
          .finally(() => {
            try {
              sample.buffer.unmap()
            } catch {
              /* Destroyed by a dispose. */
            }
            sample.state = 'free'
          })
      }
    },
    dispose() {
      disposed = true
      for (const sample of ring) sample.buffer.destroy()
    },
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
 * image is final and the next image reflects what this one did; or, `SETTLE_IMAGES` images after
 * it, whatever the hashes say. No image is ever sampled once the view is settled.
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
    /** Whether an image after the last busy one has the lit image of the one before it, or
     *  `SETTLE_IMAGES` images came after it. */
    get verified() {
      return equal > busy || images >= busy + SETTLE_IMAGES
    },
    /** The image is submitted: its copies are mapped. */
    submitted: samples.submitted,
    dispose() {
      hash.destroy()
      samples.dispose()
    },
  }
}
