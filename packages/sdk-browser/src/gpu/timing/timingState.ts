import type { GpuTimingSample } from './types.ts';
import type { TimingImage, TimingPart, TimingResources } from './encoder.ts';
import { createSampleEmitter } from './sample.ts';
import { createSlotMemory } from './slotMemory.ts';
import { createTimeline } from './timeline.ts';
import { QUERY_COUNT } from './queries.ts';

/** What the timing remembers from one image to the next: the three pieces of `createGpuTiming`
 *  (admission, readback, statistics) read and write it, none keeps a copy of its own. */
export type TimingState = {
  device: GPUDevice;
  /** Frames between two samples, read at every frame so a caller may change it. */
  every: () => number;
  emit: ReturnType<typeof createSampleEmitter>;
  enabled: boolean;
  disposed: boolean;
  /** The last image sampled at the cadence. */
  lastFrame: number;
  resources: TimingResources | undefined;
  active: (TimingImage & { frame: number; parts: Map<GPUCommandEncoder, TimingPart> }) | undefined;
  /** The readbacks in flight, by the readback buffer each holds. */
  inFlight: Map<GPUBuffer, Promise<void>>;
  tally: {
    sampledFrames: number;
    completedSamples: number;
    droppedSamples: number;
    invalidSamples: number;
    unresolvedParts: number;
  };
  skippedFrames: {
    unsupported: number;
    interval: number;
    busy: number;
    disposed: number;
    parts: number;
  };
  /** Each image's span on the device timeline, for the idle before the next (#1451). */
  timeline: ReturnType<typeof createTimeline>;
  /** What each timestamp slot held at the last image read, to tell a pass the driver skipped. */
  slots: ReturnType<typeof createSlotMemory>;
};

export function createTimingState(
  device: GPUDevice,
  asked: number | (() => number) | undefined,
  onSample: (sample: GpuTimingSample) => void,
): TimingState {
  return {
    device,
    every: () => Math.max(1, Math.floor((typeof asked === 'function' ? asked() : asked) ?? 60)),
    emit: createSampleEmitter(onSample),
    enabled: !!device.features?.has('timestamp-query'),
    disposed: false,
    lastFrame: -Infinity,
    resources: undefined,
    active: undefined,
    inFlight: new Map(),
    tally: {
      sampledFrames: 0,
      completedSamples: 0,
      droppedSamples: 0,
      invalidSamples: 0,
      unresolvedParts: 0,
    },
    skippedFrames: { unsupported: 0, interval: 0, busy: 0, disposed: 0, parts: 0 },
    timeline: createTimeline(),
    slots: createSlotMemory(QUERY_COUNT),
  };
}

export function destroyTimingResources(state: TimingState) {
  const { resources } = state;
  for (const set of resources?.sets ?? []) set.destroy();
  resources?.resolve.destroy();
  for (const read of resources?.reads ?? []) read.destroy();
  state.resources = undefined;
}
