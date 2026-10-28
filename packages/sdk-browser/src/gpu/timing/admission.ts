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
import { QUERY_SET_SIZE } from './querySetSize.ts'

/** The encoder of one submission of image `frame`: the device's own when the image is not sampled
 *  (disposed, unsupported, off the cadence, readbacks busy), the instrumented one when it is: every
 *  submission of a sampled image is a part, however many the image has. Opens the image on its first submission. */
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
  const part: TimingPart = { at: [], names: [], order: -1, resolved: false }
  const wrapper = instrumentTimingEncoder(encoder, part, image, state.resources!, state.device)
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
  // A cadence of every image reads as many at once as the neighbours' do.
  if (readsInFlight(state) >= (second || state.every() <= 1 ? READBACKS : 1)) {
    state.tally.droppedSamples++
    state.skippedFrames.busy++
    return false
  }
  const tag: TimedRead = { frame, entries: [], used: 0, metadata: {} }
  let read: GPUBuffer | undefined
  try {
    state.resources ??= {
      ...createTimingQueries(state.device, QUERY_SET_SIZE),
      readbacks: timingReadbacks(state, QUERY_SET_SIZE * 8),
    }
    read = state.resources.readbacks.take(tag, state.resources.capacity * 8)
    // A buffer free that the device does not make, or cannot map: no image is ever read back.
    if (!read) throw new Error('GPU_TIMING_READBACK_REFUSED')
  } catch (error) {
    state.enabled = false
    destroyTimingResources(state)
    state.emit(failedSample(frame, String(error)))
    return false
  }
  state.active = {
    frame,
    before: state.lastFrame,
    parts: new Map(),
    cursor: 0,
    finished: 0,
    read,
    limit: read.size / 8,
    tag,
  }
  if (!second) state.lastFrame = frame
  state.tally.sampledFrames++
  return true
}

/** Readbacks submitted and not yet read: what the ring holds, less the open image's. */
export const readsInFlight = (state: TimingState) =>
  (state.resources?.readbacks.held() ?? 0) - (state.active ? 1 : 0)

/** The open image is dropped, its readback given back unread, the buffers it grew given up. With `unused`, the image was opened for nothing
 *  (it had nothing to submit): it leaves no trace, the cadence and the dropped samples as they were. */
export function dropActive(state: TimingState, unused = false) {
  if (!state.active) return
  const { before } = state.active
  state.resources?.readbacks.dropped(state.active.read)
  state.active = undefined
  if (unused) {
    state.tally.sampledFrames--
    state.lastFrame = before
    return
  }
  // The image gave no time: the next one is asked for it, not the cadence's next.
  state.lastFrame = -Infinity
  state.tally.droppedSamples++
}
