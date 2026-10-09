/** `GPUMapMode.READ`, or its value where a test device leaves the enum empty. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1

/** Bytes of the hash: the lit image's two words, then the image before it's. */
export const RADIANCE_HASH_BYTES = 16
/** Samples in flight at most: an image's copy waits for none, the oldest of the ring is reused. */
const SAMPLES = 3

type Sample = { buffer: GPUBuffer; image: number; state: 'free' | 'copied' | 'mapping' }

/**
 * WHEN THE REFLECTIONS HAVE SETTLED. An image reflects the lit image before it, so a view that
 * stands still is not final while the lit image still changes — a light edited, a shadow arriving,
 * a particle passing —: the image drawn from it would not be the one the next draws. A radiance
 * pyramid knows it for free: the first dispatch of its build folds the lit image into a 64-bit hash
 * beside the previous image's (`radianceRoll`), and an image whose two hashes are equal has the
 * same lit image as the one before. The hash is read back, 16 bytes, while the view is not
 * settled — one copy an image, each mapped once its image is submitted (`submitted`), none ever
 * waited for: the answer comes some images later, and until then the view is unsettled.
 *
 * The view is settled once an image after the last one drawn for another reason — `busy` marks the
 * image about to be drawn for the lighting's, the cut's, the pages' own pending work — has the
 * hash of the image before it (`verified`): both images lie after the last change, so the lit
 * image is final and the next image reflects what this one did. No image is ever sampled once the
 * view is settled.
 */
export function createRadianceSettle(device: GPUDevice) {
  const hash = device.createBuffer({
    label: 'Trillion3D reflection radiance hash',
    size: RADIANCE_HASH_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const ring: Sample[] = Array.from({ length: SAMPLES }, () => ({
    buffer: device.createBuffer({
      label: 'Trillion3D reflection radiance hash sample',
      size: RADIANCE_HASH_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
    image: 0,
    state: 'free',
  }))
  let images = 0,
    busy = 0,
    equal = 0,
    disposed = false

  /** A sample's answer, when its image's hash is the one before it's. */
  const read = (sample: Sample) => {
    if (disposed) return
    const words = new Uint32Array(sample.buffer.getMappedRange(0, RADIANCE_HASH_BYTES))
    if (words[0] === words[2] && words[1] === words[3]) equal = Math.max(equal, sample.image)
  }
  return {
    hash,
    /** An image is drawn: the hash it folds is the next one. */
    drawn() {
      images++
    },
    /** The image about to be drawn is drawn for another reason than the reflections'. */
    busy() {
      busy = images + 1
    },
    /** Whether an image after the last busy one has the lit image of the one before it. */
    get verified() {
      return equal > busy
    },
    /** Copies the hash of the image drawn, to be mapped once it is submitted. */
    copy(encoder: GPUCommandEncoder) {
      const sample = ring.find((candidate) => candidate.state === 'free')
      if (!sample || disposed) return
      encoder.copyBufferToBuffer(hash, 0, sample.buffer, 0, RADIANCE_HASH_BYTES)
      sample.image = images
      sample.state = 'copied'
    },
    /** The image is submitted: its copies are mapped, and answer when the GPU has run them. */
    submitted() {
      for (const sample of ring) {
        if (sample.state !== 'copied' || disposed) continue
        sample.state = 'mapping'
        Promise.resolve(sample.buffer.mapAsync(mapRead(), 0, RADIANCE_HASH_BYTES))
          .then(() => read(sample))
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
      hash.destroy()
      for (const sample of ring) sample.buffer.destroy()
    },
  }
}
export type RadianceSettle = ReturnType<typeof createRadianceSettle>
