import { createReadbackRing } from '../gpu/core/readbackRing.ts'
import { REFLECTION_COUNTS } from './constants.ts'
import { RADIANCE_HASH_WORDS as H } from './radianceWgsl.ts'

/** Bytes of the hash: the lit image's two words, then the image before it's. */
const RADIANCE_HASH_BYTES = H.count * 4
/** Bytes of the trace's word: whether the image sampled a lobe (`trace.ts`). */
const SAMPLED_BYTES = 4
/** Bytes of a sample: the hash, then the trace's word. */
const SAMPLE_BYTES = RADIANCE_HASH_BYTES + SAMPLED_BYTES
/** Samples in flight at most: an image's copy waits for none, and takes none when all are in flight. */
const SAMPLES = 3
/** Bytes the settle holds (`createRadianceSettle`): the hash, the trace's word and the samples in
 *  flight. */
export const SETTLE_BYTES = SAMPLE_BYTES + SAMPLES * SAMPLE_BYTES
/** The trace's word cleared, written at each image's staging. */
const CLEARED = new Uint32Array(1)

/**
 * The samples of the hash, read back without a wait: a ring of staging buffers, each filled by a
 * copy in the image's commands, mapped once that image is submitted (`submitted`), and answering
 * `answer` with the words it holds and the image they are of some frames later.
 */
function createSampleRing(device: GPUDevice, answer: (tag: number, words: Uint32Array) => void) {
  const ring = createReadbackRing(
    device,
    {
      label: 'Trillion3D reflection radiance hash sample',
      bytes: SAMPLE_BYTES,
      count: SAMPLES,
      eager: true,
    },
    (mapped, _staging, tag) => answer(tag, new Uint32Array(mapped, 0, SAMPLE_BYTES / 4)),
  )
  return {
    /** Copies the hash and the trace's word into a free sample, under `tag` (`sampleTag`). */
    copy(encoder: GPUCommandEncoder, hash: GPUBuffer, sampled: GPUBuffer, tag: number) {
      // A copy still waiting for its submission is an abandoned image's: its commands never ran.
      const sample = ring.take(tag)
      if (!sample) return
      encoder.copyBufferToBuffer(hash, 0, sample, 0, RADIANCE_HASH_BYTES)
      encoder.copyBufferToBuffer(sampled, 0, sample, RADIANCE_HASH_BYTES, SAMPLED_BYTES)
    },
    /** The image is submitted: its copies are mapped, and answer when the GPU has run them. */
    submitted: ring.submitted,
    dispose: ring.destroy,
  }
}

/** A sample's tag: its image's count, and whether that image's build hashed it (`radiance.ts`). */
const sampleTag = (image: number, hashed: boolean) => 2 * image + (hashed ? 1 : 0)

/**
 * WHEN THE REFLECTIONS HAVE SETTLED. An image reflects the lit image before it, so a view that
 * stands still is not final while the lit image still changes — a light edited, a shadow arriving,
 * a particle passing —: the image drawn from it would not be the one the next draws. A radiance
 * pyramid knows it for free: the first dispatch of its build folds the lit image into a 64-bit hash
 * beside the previous image's (`radianceRoll`), and an image whose two hashes are equal has the
 * same lit image as the one before. The hash is read back, 16 bytes, while the view is not settled —
 * one copy an image, each mapped once its image is submitted, none ever waited for: the answer comes
 * some images later, and until then the view is unsettled. Only an image drawn from where the one
 * before it was is hashed (`radiance.ts`): a moving one is never the one a still view settles on.
 * The reflections' history (`temporalWgsl.ts`) freezes once the view has been quiet (`quiet`) for
 * `REFLECTION_STILL` images: from the image after (`frozen`) its radiance pyramid is no longer built,
 * so a still view reflects the same bits every image — never waiting on a lit image its own
 * reflections keep feeding, which a hash may never see repeat. An image whose trace sampled no lobe
 * (`sampled`, the trace's word, cleared at each image's staging and copied with the hash) has no
 * history to wait for: its mirrors are traced whole by their pixels, the same bits from the same lit
 * image, and the lit image alone decides (`final`).
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
  const sampled = device.createBuffer({
    label: 'Trillion3D reflection trace sampled',
    size: SAMPLED_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  let images = 0,
    busy = 0,
    moved = 0,
    equal = 0,
    bare = 0
  // A sample's answer: its image's hash is the one before it's, where it was hashed; and its trace
  // sampled no lobe.
  const samples = createSampleRing(device, (tag, words) => {
    const hashed = tag % 2 === 1,
      image = (tag - (hashed ? 1 : 0)) / 2
    const now = H.current,
      before = H.previous
    if (!hashed || words[now] !== words[before] || words[now + 1] !== words[before + 1]) return
    equal = Math.max(equal, image)
    // The trace's word follows the hash.
    if (words[H.count] === 0) bare = Math.max(bare, image)
  })
  return {
    hash,
    /** The trace's word: set where the image sampled a lobe (`trace.ts`). */
    sampled,
    /** An image is staged: while samples are taken, its trace's word cleared before its commands. */
    stage() {
      if (!this.verified) device.queue.writeBuffer(sampled, 0, CLEARED)
    },
    /** An image is drawn, its radiance pyramid encoded — its image `hashed` where it was drawn
     *  from where the one before it was (`HeldImage.still`) —: counted, and, while the view is not
     *  settled, its hash copied, to be mapped once the image is submitted (`submitted`). */
    image(encoder: GPUCommandEncoder, hashed: boolean) {
      images++
      if (!this.verified) samples.copy(encoder, hash, sampled, sampleTag(images, hashed))
    },
    /** The image about to be drawn is drawn for another reason than the reflections'. */
    busy() {
      busy = images + 1
    },
    /** The image about to be drawn is drawn for a move — the camera, a light, a body of the scene —:
     *  busy, and its history clamped (`temporalWgsl.ts`). Work landing (pages, probes, shadows) only
     *  keeps the view busy: its images accumulate unclamped. */
    move() {
      busy = moved = images + 1
    },
    /** Whether the image being drawn is drawn for a move. */
    get moving() {
      return moved === images + 1
    },
    /** The images drawn since the last busy one, the one being drawn counted: zero on an image drawn
     *  for a change — what the reflections' accumulation clamps on and freezes after
     *  (`temporalWgsl.ts`). */
    get quiet() {
      return Math.max(0, images + 1 - busy)
    },
    /** Whether the image being drawn comes after the still view's `REFLECTION_STILL`th quiet one: its
     *  history is complete and copied, its radiance pyramid not built again — the reflections are
     *  frozen, on inputs that no longer move. */
    get frozen() {
      return this.quiet > REFLECTION_COUNTS.REFLECTION_STILL
    },
    /** Whether an image after the last busy one has the lit image of the one before it. */
    get verified() {
      return equal > busy
    },
    /** Whether a still view's reflections are final: an image was drawn frozen — its history, its
     *  pyramid and its view fixed, the next draws the same bits, whatever share of the lit image its
     *  own reflections are —, or a verified image whose trace sampled no lobe: nothing accumulates. */
    get final() {
      return this.quiet > REFLECTION_COUNTS.REFLECTION_STILL + 1 || bare > busy
    },
    /** The image is submitted: its copies are mapped. */
    submitted: samples.submitted,
    dispose() {
      hash.destroy()
      sampled.destroy()
      samples.dispose()
    },
  }
}
