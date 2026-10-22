import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { applyMarks, markWords } from '../../../../sdk-core/src/bounce/probeMarks.ts'
import { KEPT, type ProbePool } from '../../../../sdk-core/src/bounce/probePool.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { createMarkTags, type MarkTag } from './markTags.ts'

/** Bitmaps in flight at once: one an image at most, never a wait. */
const IN_FLIGHT = 2

/**
 * THE CELLS THE PROBES' RAYS HIT, read back a few images late. A probe's ray lands on a surface and
 * reads the light the levels hold there (`surfaceLit`); the update marks the eight probes round that
 * point in this bitmap (`markPoint`, at most one mark a ray, only a point a level holds), so the
 * surfaces the probes see get probes of their own, seen by the image or not. Each image that
 * traces probes copies the bitmap to the staging buffer of the engine's one ring (`take`), and a few
 * images later each cell it names takes a probe from the pool, kept while its level holds it
 * (`KEPT`: no age takes it back). A pool with none left refuses the mark (`ProbePool.refused`).
 *
 * The bitmap is cleared once copied, never before: an image whose buffers are all in flight leaves
 * its bits for the next to bring back. No image waits for them.
 */
export function createHitMarks(
  device: GPUDevice,
  cascades: BounceCascades,
  pool: ProbePool,
  bitmap: GPUBuffer,
) {
  const bytes = markWords(cascades) * 4
  const tags = createMarkTags(cascades, IN_FLIGHT)
  const ring = createReadbackRing<MarkTag>(
    device,
    { label: 'Trillion3D bounce hit marks readback', bytes, count: IN_FLIGHT },
    (mapped, _staging, tag) =>
      void applyMarks(new Uint32Array(mapped, 0, bytes / 4), tag.bases, cascades, pool, KEPT),
  )
  let staging: GPUBuffer | undefined
  return {
    /** Marks in flight: the series is not closed while there are any. */
    get pending() {
      return ring.held() > 0
    },
    /** Whether image `frame` reads its marks back: a buffer of the ring is free to bring them. */
    begin(frame: number) {
      staging = tags.take(ring, bytes, frame)
      return !!staging
    },
    /** The bitmap copied to the staging buffer `begin` took, then cleared, after the pass. */
    copy(encoder: GPUCommandEncoder) {
      if (!staging) return
      encoder.copyBufferToBuffer(bitmap, 0, staging, 0, bytes)
      encoder.clearBuffer(bitmap)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    dispose: () => ring.destroy(),
  }
}
