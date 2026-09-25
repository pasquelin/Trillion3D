import type { GpuTimingSample } from './types.ts';
export type { GpuTimingSample } from './types.ts';
import {
  createTimingResources,
  instrumentTimingEncoder,
  type TimingImage,
  type TimingPart,
  type TimingResources,
} from './encoder.ts';
import { createSampleEmitter, timingEntries, summarizeTimestamps } from './sample.ts';
import { PARTS, QUERY_COUNT, TIMED_PASSES } from './queries.ts';
export function createGpuTiming(
  device: GPUDevice,
  options: { sampleEveryFrames?: number; onSample: (sample: GpuTimingSample) => void },
) {
  const sampleEveryFrames = Math.max(1, Math.floor(options.sampleEveryFrames ?? 60));
  let enabled = !!device.features?.has('timestamp-query'),
    disposed = false,
    lastFrame = -sampleEveryFrames;
  let resources: TimingResources | undefined;

  let active:
    (TimingImage & { frame: number; parts: Map<GPUCommandEncoder, TimingPart> }) | undefined;
  let pending: Promise<void> | undefined;
  let sampledFrames = 0,
    completedSamples = 0,
    droppedSamples = 0,
    invalidSamples = 0,
    unresolvedParts = 0;
  const skippedFrames = { unsupported: 0, interval: 0, busy: 0, disposed: 0, parts: 0 };
  const emit = createSampleEmitter(options.onSample);
  const destroy = () => {
    for (const set of resources?.sets ?? []) set.destroy();
    resources?.resolve.destroy();
    resources?.read.destroy();
    resources = undefined;
  };
  const timing = {
    get supported() {
      return enabled && !disposed;
    },
    isSampled(encoder: GPUCommandEncoder) {
      return !!active?.parts.has(encoder);
    },
    createEncoder(frame: number): GPUCommandEncoder {
      const encoder = device.createCommandEncoder();
      if (disposed) {
        skippedFrames.disposed++;
        return encoder;
      }
      if (!enabled) {
        skippedFrames.unsupported++;
        return encoder;
      }
      // A frame left open never got its closing submission; it is dropped rather than mixed into this one.
      if (active && active.frame !== frame) {
        active = undefined;
        droppedSamples++;
      }
      if (!active) {
        if (frame - lastFrame < sampleEveryFrames) {
          skippedFrames.interval++;
          return encoder;
        }
        if (pending) {
          droppedSamples++;
          skippedFrames.busy++;
          return encoder;
        }
        try {
          resources ??= createTimingResources(device, QUERY_COUNT);
        } catch (error) {
          enabled = false;
          destroy();
          emit({
            frame,
            totalMs: null,
            frameMs: null,
            submittedMs: null,
            hostGapMs: null,
            passes: [],
            truncated: false,
            error: String(error),
          });
          return encoder;
        }
        active = { frame, parts: new Map(), truncated: false, cursor: 0 };
        lastFrame = frame;
        sampledFrames++;
      }
      const state = active;
      if (state.parts.size >= PARTS) {
        state.truncated = true;
        skippedFrames.parts++;
        return encoder;
      }
      const part: TimingPart = { slot: state.parts.size, base: -1, names: [], resolved: false };
      const wrapper = instrumentTimingEncoder(encoder, part, state, resources!, QUERY_COUNT);
      state.parts.set(wrapper, part);
      return wrapper;
    },
    /** Closes the image: `encoder` is its last submission, and every part resolved so far is read. */
    submitted(encoder: GPUCommandEncoder, metadata: Record<string, unknown>) {
      const state = active;
      if (!state || !state.parts.has(encoder)) return;
      active = undefined;
      const collected = timingEntries(state.parts.values(), state.truncated);
      const { entries, truncated } = collected;
      unresolvedParts += collected.unresolvedParts;
      if (!entries.length || !resources) return;
      const staging = resources.read,
        used = state.cursor * 8;
      pending = (async () => {
        try {
          // Only the timestamps the image wrote are mapped.
          await staging.mapAsync(GPUMapMode.READ, 0, used);
          if (disposed) return;
          const values = new BigUint64Array(staging.getMappedRange(0, used));
          const { sample, invalidSamples: invalid } = summarizeTimestamps(
            entries,
            values,
            truncated,
          );
          invalidSamples += invalid;
          emit({ ...metadata, frame: state.frame, ...sample });
          completedSamples++;
        } catch (error) {
          if (!disposed) {
            enabled = false;
            emit({
              ...metadata,
              frame: state.frame,
              totalMs: null,
              frameMs: null,
              submittedMs: null,
              hostGapMs: null,
              passes: [],
              truncated,
              error: String(error),
            });
            completedSamples++;
          }
        } finally {
          try {
            staging.unmap();
          } catch {
            /* Disposal or device loss can cancel a mapping. */
          }
        }
      })().finally(() => {
        pending = undefined;
      });
    },
    cancelUnsubmitted() {
      if (active) {
        active = undefined;
        droppedSamples++;
      }
    },
    async flush() {
      await pending;
    },
    stats() {
      return {
        supported: enabled && !disposed,
        reason: disposed ? 'disposed' : enabled ? '' : 'timestamp-query-unavailable',
        sampleEveryFrames,
        sampledFrames,
        completedSamples,
        droppedSamples,
        invalidSamples,
        unresolvedParts,
        skippedFrames: { ...skippedFrames },
        pending: pending ? 1 : 0,
        maxPending: 1,
        maxPasses: TIMED_PASSES,
        maxParts: PARTS,
        queryCount: QUERY_COUNT,
      };
    },
    dispose() {
      disposed = true;
      active = undefined;
      destroy();
    },
  };
  return timing;
}
