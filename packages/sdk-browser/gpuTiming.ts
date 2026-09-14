import type { GpuTimingSample } from './gpuTimingTypes.ts';
export type { GpuTimingSample } from './gpuTimingTypes.ts';
import {
  createTimingResources,
  instrumentTimingEncoder,
  type TimingPart,
} from './gpuTimingEncoder.ts';
import { createSampleEmitter, timingEntries, summarizeTimestamps } from './gpuTimingSample.ts';
/** Query slots per encoder part, and parts per image: the query set holds `PARTS × PART_QUERIES`. */
const PART_QUERIES = 128,
  PARTS = 4;
export function createGpuTiming(
  device: GPUDevice,
  options: { sampleEveryFrames?: number; onSample: (sample: GpuTimingSample) => void },
) {
  const maxPasses = PART_QUERIES / 2,
    queryCount = PART_QUERIES * PARTS;
  const sampleEveryFrames = Math.max(1, Math.floor(options.sampleEveryFrames ?? 60));
  let enabled = !!device.features?.has('timestamp-query'),
    disposed = false,
    lastFrame = -sampleEveryFrames;
  let query: GPUQuerySet | undefined, resolve: GPUBuffer | undefined, read: GPUBuffer | undefined;

  let active:
    { frame: number; parts: Map<GPUCommandEncoder, TimingPart>; truncated: boolean } | undefined;
  let pending: Promise<void> | undefined;
  let sampledFrames = 0,
    completedSamples = 0,
    droppedSamples = 0,
    invalidSamples = 0,
    unresolvedParts = 0;
  const skippedFrames = { unsupported: 0, interval: 0, busy: 0, disposed: 0, parts: 0 };
  const emit = createSampleEmitter(options.onSample);
  const destroy = () => {
    query?.destroy();
    resolve?.destroy();
    read?.destroy();
    query = undefined;
    resolve = undefined;
    read = undefined;
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
          if (!query) {
            ({ query, resolve, read } = createTimingResources(device, queryCount));
          }
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
        active = { frame, parts: new Map(), truncated: false };
        lastFrame = frame;
        sampledFrames++;
      }
      const state = active;
      if (state.parts.size >= PARTS) {
        state.truncated = true;
        skippedFrames.parts++;
        return encoder;
      }
      const part: TimingPart = { slot: state.parts.size, names: [], resolved: false };
      const wrapper = instrumentTimingEncoder(
        encoder,
        part,
        state,
        { query: query!, resolve: resolve!, read: read! },
        maxPasses,
        PART_QUERIES,
      );
      state.parts.set(wrapper, part);
      return wrapper;
    },
    /** Closes the image: `encoder` is its last submission, and every part resolved so far is read. */
    submitted(encoder: GPUCommandEncoder, metadata: Record<string, unknown>) {
      const state = active;
      if (!state || !state.parts.has(encoder)) return;
      active = undefined;
      const collected = timingEntries(state.parts.values(), state.truncated, PART_QUERIES);
      const { entries, truncated } = collected;
      unresolvedParts += collected.unresolvedParts;
      if (!entries.length || !read) return;
      const staging = read;
      pending = (async () => {
        try {
          await staging.mapAsync(GPUMapMode.READ);
          if (disposed) return;
          const values = new BigUint64Array(staging.getMappedRange());
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
        maxPasses,
        maxParts: PARTS,
        queryCount,
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
