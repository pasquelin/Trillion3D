import type { GpuFrameMs, GpuPassTimings } from '../../../../sdk-core/src/index.ts'

/** Why an image has no `frameMs` (`GpuTimingSample`). */
export type FrameMsReason = 'truncated' | 'no-valid-pair' | 'failed'
/** Timed passes by the state their timestamp pair read in: usable, unwritten or unreadable. */
export type TimingPairs = { valid: number; unwritten: number; invalid: number }

/**
 * GPU durations pass by pass, from `timestamp-query`. One image may span several command encoders —
 * the selection dispatch is submitted before the render encoder — so a sample collects every part of
 * the same image and closes when the caller submits the last one. The readback never blocks an image:
 * the sample is handed to `onSample` when the mapping resolves, which is later than the image it
 * describes. `totalMs` sums the listed passes and nothing else; it is never added to a CPU duration.
 * `frameMs` is the enclosing span instead — the earliest beginning to the latest end of the passes
 * that have a valid pair, over every part — so a device that runs passes concurrently, where the
 * sum overcounts, still yields one honest duration. A pass without a valid pair is outside it: one
 * the driver skipped wrote no timestamp (`unwritten`), one whose pair cannot be read (a timestamp
 * missing, or the end before the beginning) is `invalid`; neither voids the span the other passes
 * make. `submittedMs` is the GPU time proper: the time the per-submission spans cover, an overlap
 * of two counted once, without the host gap a span between two submissions of the same image would
 * otherwise carry. For an image that submits once it is `frameMs`. Both are null together, and
 * `frameMsReason` says why: `truncated` (a pass went untimed, so the span would miss its end),
 * `no-valid-pair` (every pair unwritten or invalid), `failed` (the readback did).
 *
 * `idleBetweenMs` is the gap neither holds (#1451): the device's idle from the last timestamp of
 * the image numbered `frame − 1` to the first of this one, so an image that submits once — whose
 * `hostGapMs` is always zero — still says how long the device stood unused before it. It is read
 * between neighbours only: the image after one sampled at the cadence is sampled too, and when the
 * previous SAMPLED image is not `frame − 1` (a stride, a busy readback, a held frame between them)
 * it is `null`, never the gap to the older one, whose span holds the untimed images' work. Also
 * `null` when either image is not whole (truncated, an invalid timestamp), when the timeline went
 * backwards, and past a pause (`IDLE_CEILING_MS`, `timeline.ts`). Untimed GPU work between the two
 * images — uploads and copies outside a timed pass — counts in it.
 */
export type GpuTimingSample = GpuPassTimings & {
  frameMs: GpuFrameMs
  submittedMs: GpuFrameMs
  /** Why `frameMs` is null, and null when it is not. */
  frameMsReason: FrameMsReason | null
  /** The image's timed passes by the state their timestamp pair read in. */
  pairs: TimingPairs
  hostGapMs: number | null
  idleBetweenMs: number | null
  [key: string]: unknown
}

/**
 * Nanoseconds to milliseconds. The GPU timestamps return nanoseconds and the timers publish
 * milliseconds; one division, so one published unit.
 */
export const nanosecondsToMs = (nanoseconds: number) => nanoseconds / 1e6
