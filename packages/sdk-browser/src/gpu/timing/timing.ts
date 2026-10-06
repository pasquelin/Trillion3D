import type { GpuTimingSample } from './types.ts';
export type { GpuTimingSample } from './types.ts';
import { READBACKS } from './encoder.ts';
import { createTimedEncoder } from './admission.ts';
import { closeTimedImage } from './closeImage.ts';
import { createTimingState, destroyTimingResources } from './timingState.ts';
import { PARTS, QUERY_COUNT, TIMED_PASSES } from './queries.ts';
export function createGpuTiming(
  device: GPUDevice,
  options: {
    /** Frames between two samples; a function is read at every frame, so a caller may change it. */
    sampleEveryFrames?: number | (() => number);
    onSample: (sample: GpuTimingSample) => void;
  },
) {
  const state = createTimingState(device, options.sampleEveryFrames, options.onSample);
  const timing = {
    get supported() {
      return state.enabled && !state.disposed;
    },
    isSampled(encoder: GPUCommandEncoder) {
      return !!state.active?.parts.has(encoder);
    },
    createEncoder(frame: number): GPUCommandEncoder {
      return createTimedEncoder(state, frame);
    },
    submitted(encoder: GPUCommandEncoder, metadata: Record<string, unknown>) {
      closeTimedImage(state, encoder, metadata);
    },
    cancelUnsubmitted() {
      if (state.active) {
        state.active = undefined;
        state.tally.droppedSamples++;
      }
    },
    async flush() {
      await Promise.all(state.inFlight.values());
    },
    stats() {
      const { tally } = state;
      return {
        supported: state.enabled && !state.disposed,
        reason: state.disposed ? 'disposed' : state.enabled ? '' : 'timestamp-query-unavailable',
        sampleEveryFrames: state.every(),
        sampledFrames: tally.sampledFrames,
        completedSamples: tally.completedSamples,
        droppedSamples: tally.droppedSamples,
        invalidSamples: tally.invalidSamples,
        unresolvedParts: tally.unresolvedParts,
        skippedFrames: { ...state.skippedFrames },
        pending: state.inFlight.size,
        maxPending: READBACKS,
        maxPasses: TIMED_PASSES,
        maxParts: PARTS,
        queryCount: QUERY_COUNT,
      };
    },
    dispose() {
      state.disposed = true;
      state.active = undefined;
      destroyTimingResources(state);
    },
  };
  return timing;
}
