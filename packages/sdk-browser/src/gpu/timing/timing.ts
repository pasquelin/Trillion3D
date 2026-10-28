import type { GpuTimingSample } from './types.ts'
import { READBACKS } from './encoder.ts'
import { QUERY_SET_SIZE } from './querySetSize.ts'
import { createTimedEncoder, dropActive, readsInFlight } from './admission.ts'
import { closeTimedImage } from './closeImage.ts'
import { createTimingState, destroyTimingResources } from './timingState.ts'
export function createGpuTiming(
  device: GPUDevice,
  options: {
    /** Frames between two samples; a function is read at every frame, so a caller may change it. */
    sampleEveryFrames?: number | (() => number)
    onSample: (sample: GpuTimingSample) => void
  },
) {
  const state = createTimingState(device, options.sampleEveryFrames, options.onSample)
  const timing = {
    get supported() {
      return state.enabled && !state.disposed
    },
    isSampled(encoder: GPUCommandEncoder) {
      return !!state.active?.parts.has(encoder)
    },
    createEncoder(frame: number): GPUCommandEncoder {
      return createTimedEncoder(state, frame)
    },
    submitted(encoder: GPUCommandEncoder, metadata: Record<string, unknown>) {
      closeTimedImage(state, encoder, metadata)
    },
    cancelUnsubmitted: () => dropActive(state),
    /** The image opened for a submission that had nothing to submit: dropped without a trace, the cadence as it was. */
    cancelUnused: () => dropActive(state, true),
    /** A frame held on an answer still in flight (or a target not granted) drew nothing: counted among the frames not timed, with its cause
     *  — unless the timer is off, which `unsupported` and `disposed` already count. */
    skippedAnswering() {
      if (state.enabled && !state.disposed) state.skippedFrames.answering++
    },
    async flush() {
      await state.reading
    },
    stats() {
      const { tally } = state
      return {
        supported: state.enabled && !state.disposed,
        reason: state.disposed ? 'disposed' : state.enabled ? null : 'timestamp-query-unavailable',
        sampleEveryFrames: state.every(),
        sampledFrames: tally.sampledFrames,
        completedSamples: tally.completedSamples,
        droppedSamples: tally.droppedSamples,
        invalidSamples: tally.invalidSamples,
        unwrittenPairs: tally.unwrittenPairs,
        skippedFrames: { ...state.skippedFrames },
        pending: readsInFlight(state),
        maxPending: READBACKS,
        // The timer's resources are made at the first sampled image: before, the capacity it will be made with.
        queryCount:
          state.resources?.capacity ?? (state.enabled && !state.disposed ? QUERY_SET_SIZE : 0),
      }
    },
    dispose() {
      state.disposed = true
      state.active = undefined
      destroyTimingResources(state)
    },
  }
  return timing
}
