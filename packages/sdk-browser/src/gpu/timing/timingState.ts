import type { GpuTimingSample } from './types.ts'
import type { TimingImage, TimingPart, TimingResources } from './encoder.ts'
import { gpuCapsOf } from '../core/gpuCaps.ts'
import { createSampleEmitter } from './sample.ts'
import { createSlotMemory } from './slotMemory.ts'
import { createTimeline } from './timeline.ts'
import { QUERY_SET_SIZE } from './querySetSize.ts'

/** What the timing remembers from one image to the next: the three pieces of `createGpuTiming`
 *  (admission, readback, statistics) read and write it, none keeps a copy of its own. */
export type TimingState = {
  device: GPUDevice
  /** Frames between two samples, read at every frame so a caller may change it. */
  every: () => number
  apart: () => boolean
  emit: ReturnType<typeof createSampleEmitter>
  enabled: boolean
  disposed: boolean
  /** The last image sampled at the cadence. */
  lastFrame: number
  resources: TimingResources | undefined
  /** `before`: the cadence's last frame as the image found it (`dropActive` with `unused` restores it). */
  active:
    | (TimingImage & { frame: number; before: number; parts: Map<GPUCommandEncoder, TimingPart> })
    | undefined
  /** Held once every image read back so far is read (`closeImage.ts`). */
  reading: Promise<void>
  tally: {
    sampledFrames: number
    completedSamples: number
    droppedSamples: number
    invalidSamples: number
    /** Timestamp pairs no pass of the image wrote (a pass the driver skipped), over all images read. */
    unwrittenPairs: number
  }
  skippedFrames: {
    unsupported: number
    interval: number
    busy: number
    disposed: number
    /** Frames held on an answer still in flight (a pipeline compiling, a target not granted): nothing was drawn, so no image was there to time (`holdWebgpuFrame`). */
    answering: number
    /** Images that needed more timestamps than the timer can have (`MAX_QUERIES`), or whose growth the device refused. */
    overflow: number
  }
  /** Each image's span on the device timeline, for the idle before the next. */
  timeline: ReturnType<typeof createTimeline>
  /** What each timestamp slot held at the last image read, to tell a pass the driver skipped. */
  slots: ReturnType<typeof createSlotMemory>
}

export function createTimingState(
  device: GPUDevice,
  asked: number | (() => number) | undefined,
  onSample: (sample: GpuTimingSample) => void,
  apart: () => boolean = () => false,
): TimingState {
  return {
    device,
    every: () => Math.max(1, Math.floor((typeof asked === 'function' ? asked() : asked) ?? 60)),
    apart,
    emit: createSampleEmitter(onSample),
    enabled: gpuCapsOf(device).timestamp,
    disposed: false,
    lastFrame: -Infinity,
    resources: undefined,
    active: undefined,
    reading: Promise.resolve(),
    tally: {
      sampledFrames: 0,
      completedSamples: 0,
      droppedSamples: 0,
      invalidSamples: 0,
      unwrittenPairs: 0,
    },
    skippedFrames: { unsupported: 0, interval: 0, busy: 0, disposed: 0, answering: 0, overflow: 0 },
    timeline: createTimeline(),
    slots: createSlotMemory(QUERY_SET_SIZE),
  }
}

export function destroyTimingResources(state: TimingState) {
  const { resources } = state
  for (const set of resources?.sets ?? []) set.destroy()
  resources?.resolve.destroy()
  if (resources) resources.alive = false
  resources?.readbacks.destroy()
  state.resources = undefined
}
