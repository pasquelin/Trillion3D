import { createReadbackRing, ReadbackRefused } from '../core/readbackRing.ts'
import { failedSample, summarizeTimestamps, timingEntries } from './sample.ts'
import { READBACKS, type TimedRead } from './encoder.ts'
import type { TimingState } from './timingState.ts'

/** Closes the image: `encoder` is its last submission, and every part resolved so far is read. */
export function closeTimedImage(
  state: TimingState,
  encoder: GPUCommandEncoder,
  metadata: Record<string, unknown>,
) {
  const image = state.active
  if (!image || !image.parts.has(encoder)) return
  state.active = undefined
  const entries = timingEntries(image.parts.values())
  const readbacks = state.resources?.readbacks
  const ring = image.read
  // An image that outgrew the timer is not timed whole: none of it is read (`requestGrowth`, `MAX_QUERIES`).
  if (image.overflowed) {
    state.skippedFrames.overflow++
    state.tally.droppedSamples++
    state.lastFrame = -Infinity
    return void readbacks?.dropped(ring)
  }
  // An image that timed nothing costs no cadence: the next image is asked for its time, so a frame time is never lost to the interval.
  if (!entries.length) {
    state.lastFrame = -Infinity
    return void readbacks?.dropped(ring)
  }
  Object.assign(image.tag, { entries, used: image.cursor * 8, metadata })
  readbacks?.submitted(ring)
}

/**
 * The ring an image's timestamps come back through (`../core/readbackRing.ts`): `READBACKS`
 * buffers of `bytes`, each read in place once mapped and its sample emitted; a read that fails —
 * its mapping refused, or its summary — emits the failed sample instead, and a refused mapping also disables the timing,
 * unless the timing was disposed meanwhile. `state.reading` is held once every read is done.
 */
export function timingReadbacks(state: TimingState, bytes: number) {
  const label = 'Trillion3D timestamp readback'
  return createReadbackRing<TimedRead>(
    state.device,
    {
      label,
      bytes,
      count: READBACKS,
      eager: true,
      // Only the range the image wrote is mapped.
      used: (image) => image.used,
      chain(read, image) {
        const done = read().catch((error) => failed(state, image, error))
        state.reading = state.reading.then(() => done)
      },
    },
    (mapped, _staging, image) => emitImage(state, mapped, image),
  )
}

/** One image's timestamps, mapped, summarised and emitted. */
function emitImage(state: TimingState, mapped: ArrayBuffer, image: TimedRead) {
  const { frame, used, entries } = image
  // Only the timestamps the image wrote are read: the range mapped.
  const values = new BigUint64Array(mapped, 0, used / 8)
  state.slots.ensure(values.length)
  const { sample, span } = summarizeTimestamps(entries, values, state.slots.read(frame))
  const idleBetweenMs = state.timeline.read(frame, span)
  state.tally.invalidSamples += sample.pairs.invalid
  state.tally.unwrittenPairs += sample.pairs.unwritten
  state.emit({ ...image.metadata, frame, ...sample, idleBetweenMs })
  state.tally.completedSamples++
}

/** A read that failed: the failed sample emitted, by the device's own words when it refused the mapping — which also disables the timing —, unless disposed. */
function failed(state: TimingState, image: TimedRead, error: unknown) {
  if (state.disposed) return
  // Only a device that refuses to map the buffer loses the timer: an image whose summary failed is a failed sample, and the next is timed as any.
  if (error instanceof ReadbackRefused) state.enabled = false
  const why = String(error instanceof ReadbackRefused ? error.cause : error)
  state.emit({ ...image.metadata, ...failedSample(image.frame, why) })
  state.tally.completedSamples++
}
