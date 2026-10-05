import type { GpuTimingSample } from './types.ts';
export type { GpuTimingSample } from './types.ts';
import {
  READBACKS,
  createTimingResources,
  instrumentTimingEncoder,
  type TimingImage,
  type TimingPart,
  type TimingResources,
} from './encoder.ts';
import { createSampleEmitter, failedSample, summarizeTimestamps, timingEntries } from './sample.ts';
import { createSlotMemory } from './slotMemory.ts';
import { createTimeline } from './timeline.ts';
import { PARTS, QUERY_COUNT, TIMED_PASSES } from './queries.ts';
export function createGpuTiming(
  device: GPUDevice,
  options: {
    /** Frames between two samples; a function is read at every frame, so a caller may change it. */
    sampleEveryFrames?: number | (() => number);
    onSample: (sample: GpuTimingSample) => void;
  },
) {
  const asked = options.sampleEveryFrames;
  const every = () =>
    Math.max(1, Math.floor((typeof asked === 'function' ? asked() : asked) ?? 60));
  let enabled = !!device.features?.has('timestamp-query'),
    disposed = false,
    /** The last image sampled at the cadence. */
    lastFrame = -Infinity;
  let resources: TimingResources | undefined;

  let active:
    (TimingImage & { frame: number; parts: Map<GPUCommandEncoder, TimingPart> }) | undefined;
  /** The readbacks in flight, by the readback buffer each holds. */
  const inFlight = new Map<GPUBuffer, Promise<void>>();
  let sampledFrames = 0,
    completedSamples = 0,
    droppedSamples = 0,
    invalidSamples = 0,
    unresolvedParts = 0;
  const skippedFrames = { unsupported: 0, interval: 0, busy: 0, disposed: 0, parts: 0 };
  const emit = createSampleEmitter(options.onSample);
  /** Each image's span on the device timeline, for the idle before the next (#1451). */
  const timeline = createTimeline();
  /** What each timestamp slot held at the last image read, to tell a pass the driver skipped. */
  const slots = createSlotMemory(QUERY_COUNT);
  const destroy = () => {
    for (const set of resources?.sets ?? []) set.destroy();
    resources?.resolve.destroy();
    for (const read of resources?.reads ?? []) read.destroy();
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
        // The image right after one sampled at the cadence is sampled too, into the second
        // readback: the device idle between two images is only read between neighbours (#1451).
        const second = frame === lastFrame + 1;
        if (!second && frame - lastFrame < every()) {
          skippedFrames.interval++;
          return encoder;
        }
        if (inFlight.size >= (second ? READBACKS : 1)) {
          droppedSamples++;
          skippedFrames.busy++;
          return encoder;
        }
        try {
          resources ??= createTimingResources(device, QUERY_COUNT);
        } catch (error) {
          enabled = false;
          destroy();
          emit(failedSample(frame, false, String(error)));
          return encoder;
        }
        const read = resources.reads.find((buffer) => !inFlight.has(buffer))!;
        active = { frame, parts: new Map(), truncated: false, cursor: 0, read };
        if (!second) lastFrame = frame;
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
      const staging = state.read,
        used = state.cursor * 8;
      const readback = (async () => {
        try {
          // Only the timestamps the image wrote are mapped.
          await staging.mapAsync(GPUMapMode.READ, 0, used);
          if (disposed) return;
          const values = new BigUint64Array(staging.getMappedRange(0, used));
          const { sample, span } = summarizeTimestamps(
            entries,
            values,
            truncated,
            slots.read(state.frame),
          );
          invalidSamples += sample.pairs.invalid;
          const idleBetweenMs = timeline.read(state.frame, span);
          emit({ ...metadata, frame: state.frame, ...sample, idleBetweenMs });
          completedSamples++;
        } catch (error) {
          if (!disposed) {
            enabled = false;
            emit({ ...metadata, ...failedSample(state.frame, truncated, String(error)) });
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
        inFlight.delete(staging);
      });
      inFlight.set(staging, readback);
    },
    cancelUnsubmitted() {
      if (active) {
        active = undefined;
        droppedSamples++;
      }
    },
    async flush() {
      await Promise.all(inFlight.values());
    },
    stats() {
      return {
        supported: enabled && !disposed,
        reason: disposed ? 'disposed' : enabled ? '' : 'timestamp-query-unavailable',
        sampleEveryFrames: every(),
        sampledFrames,
        completedSamples,
        droppedSamples,
        invalidSamples,
        unresolvedParts,
        skippedFrames: { ...skippedFrames },
        pending: inFlight.size,
        maxPending: READBACKS,
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
