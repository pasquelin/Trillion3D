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
  const collected = timingEntries(image.parts.values(), image.truncated)
  const { entries, truncated } = collected
  state.tally.unresolvedParts += collected.unresolvedParts
  const readbacks = state.resources?.readbacks
  if (!entries.length) return void readbacks?.dropped(image.read)
  Object.assign(image.tag, { entries, truncated, used: image.cursor * 8, metadata })
  readbacks?.submitted(image.read)
}

/**
 * The ring an image's timestamps come back through (`../core/readbackRing.ts`): `READBACKS`
 * buffers of `bytes`, each read in place once mapped and its sample emitted; a read that fails —
 * its mapping refused, or its summary — disables the timing and emits the failed sample instead,
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
  const { frame, used } = image
  // Only the timestamps the image wrote are read.
  const values = new BigUint64Array(mapped, 0, used / 8)
  const { entries, truncated } = image
  const { sample, span } = summarizeTimestamps(entries, values, truncated, state.slots.read(frame))
  const idleBetweenMs = state.timeline.read(frame, span)
  state.tally.invalidSamples += sample.pairs.invalid
  state.emit({ ...image.metadata, frame, ...sample, idleBetweenMs })
  state.tally.completedSamples++
}

/** A read that failed: the timing disabled and the failed sample emitted, by the device's own words
 *  when it refused the mapping, unless disposed. */
function failed(state: TimingState, image: TimedRead, error: unknown) {
  if (state.disposed) return
  state.enabled = false
  const why = String(error instanceof ReadbackRefused ? error.cause : error)
  state.emit({ ...image.metadata, ...failedSample(image.frame, image.truncated, why) })
  state.tally.completedSamples++
}
