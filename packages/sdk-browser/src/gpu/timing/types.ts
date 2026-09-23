import type { GpuFrameMs, GpuPassTimings } from '../../../../sdk-core/src/index.ts';
/**
 * GPU durations pass by pass, from `timestamp-query`. One image may span several command encoders —
 * the selection dispatch is submitted before the render encoder — so a sample collects every part of
 * the same image and closes when the caller submits the last one. The readback never blocks an image:
 * the sample is handed to `onSample` when the mapping resolves, which is later than the image it
 * describes. `totalMs` sums the listed passes and nothing else; it is never added to a CPU duration.
 * `frameMs` is the enclosing span instead — earliest beginning to latest end over every part — so a
 * device that runs passes concurrently, where the sum overcounts, still yields one honest duration.
 * `submittedMs` is the GPU time proper: the sum of the per-submission spans, without the host gap a
 * span between two submissions of the same image would otherwise carry.
 */
export type GpuTimingSample = GpuPassTimings & {
  frameMs: GpuFrameMs;
  submittedMs: GpuFrameMs;
  hostGapMs: number | null;
  [key: string]: unknown;
};

/**
 * Nanoseconds to milliseconds. Both GPU timers — WebGPU timestamps and the WebGL2 duration query —
 * return nanoseconds and publish milliseconds; one division, so one published unit.
 */
export const nanosecondsToMs = (nanoseconds: number) => nanoseconds / 1e6;
