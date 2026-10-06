import {
  READBACKS,
  createTimingResources,
  instrumentTimingEncoder,
  type TimingPart,
} from './encoder.ts'
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
  if (state.active && state.active.frame !== frame) {
    state.active = undefined
    state.tally.droppedSamples++
  }
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
  // readback: the device idle between two images is only read between neighbours (#1451).
  const second = frame === state.lastFrame + 1
  if (!second && frame - state.lastFrame < state.every()) {
    state.skippedFrames.interval++
    return false
  }
  if (state.inFlight.size >= (second ? READBACKS : 1)) {
    state.tally.droppedSamples++
    state.skippedFrames.busy++
    return false
  }
  try {
    state.resources ??= createTimingResources(state.device, QUERY_COUNT)
  } catch (error) {
    state.enabled = false
    destroyTimingResources(state)
    state.emit(failedSample(frame, false, String(error)))
    return false
  }
  const read = state.resources.reads.find((buffer) => !state.inFlight.has(buffer))!
  state.active = { frame, parts: new Map(), truncated: false, cursor: 0, read }
  if (!second) state.lastFrame = frame
  state.tally.sampledFrames++
  return true
}
