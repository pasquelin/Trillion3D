import {
  READBACKS,
  createTimingQueries,
  instrumentTimingEncoder,
  type TimedRead,
  type TimingPart,
} from './encoder.ts'
import { timingReadbacks } from './closeImage.ts'
import { failedSample } from './sample.ts'
import { destroyTimingResources, type TimingState } from './timingState.ts'
import { PARTS, QUERY_COUNT } from './queries.ts'

/** The encoder of one submission of image `frame`: the device's own when the image is not sampled
 *  (disposed, unsupported, off the cadence, readbacks busy, no more parts), the instrumented one
 *  when it is. Opens the image on its first submission. */
export function createTimedEncoder(state: TimingState, frame: number): GPUCommandEncoder {
  const encoder = state.device.createCommandEncoder()
  if (state.disposed) {
    state.skippedFrames.disposed++
    return encoder
  }
  if (!state.enabled) {
    state.skippedFrames.unsupported++
    return encoder
  }
  // A frame left open never got its closing submission; it is dropped rather than mixed into this one.
  if (state.active && state.active.frame !== frame) dropActive(state)
  if (!state.active && !openImage(state, frame)) return encoder
  const image = state.active!
  if (image.parts.size >= PARTS) {
    image.truncated = true
    state.skippedFrames.parts++
    return encoder
  }
  const part: TimingPart = { slot: image.parts.size, base: -1, names: [], resolved: false }
  const wrapper = instrumentTimingEncoder(encoder, part, image, state.resources!, QUERY_COUNT)
  image.parts.set(wrapper, part)
  return wrapper
}

/** Starts sampling image `frame` when the cadence and the readbacks allow it. */
function openImage(state: TimingState, frame: number) {
  // The image right after one sampled at the cadence is sampled too, into the second
  // readback: the device idle between two images is only read between neighbours.
  const second = frame === state.lastFrame + 1
  if (!second && frame - state.lastFrame < state.every()) {
    state.skippedFrames.interval++
    return false
  }
  if (readsInFlight(state) >= (second ? READBACKS : 1)) {
    state.tally.droppedSamples++
    state.skippedFrames.busy++
    return false
  }
  const tag: TimedRead = { frame, entries: [], truncated: false, used: 0, metadata: {} }
  let read: GPUBuffer | undefined
  try {
    state.resources ??= {
      ...createTimingQueries(state.device, QUERY_COUNT),
      readbacks: timingReadbacks(state, QUERY_COUNT * 8),
    }
    read = state.resources.readbacks.take(tag)
    // A buffer free that the device does not make, or cannot map: no image is ever read back.
    if (!read) throw new Error('GPU_TIMING_READBACK_REFUSED')
  } catch (error) {
    state.enabled = false
    destroyTimingResources(state)
    state.emit(failedSample(frame, false, String(error)))
    return false
  }
  state.active = { frame, parts: new Map(), truncated: false, cursor: 0, read, tag }
  if (!second) state.lastFrame = frame
  state.tally.sampledFrames++
  return true
}

/** Readbacks submitted and not yet read: what the ring holds, less the open image's. */
export const readsInFlight = (state: TimingState) =>
  (state.resources?.readbacks.held() ?? 0) - (state.active ? 1 : 0)

/** The open image is dropped, its readback given back unread. */
export function dropActive(state: TimingState) {
  if (!state.active) return
  state.resources?.readbacks.dropped(state.active.read)
  state.active = undefined
  state.tally.droppedSamples++
}
