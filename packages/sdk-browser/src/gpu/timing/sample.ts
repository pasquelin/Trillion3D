import {
  nanosecondsToMs,
  type FrameMsReason,
  type GpuTimingSample,
  type TimingPairs,
} from './types.ts';
import type { TimingPart } from './encoder.ts';
import type { ImageSpan } from './timeline.ts';
import type { Stale } from './slotMemory.ts';

export function createSampleEmitter(onSample: (sample: GpuTimingSample) => void) {
  return (sample: GpuTimingSample) => {
    try {
      onSample({ source: 'timestamp-query', ...sample });
    } catch {
      /* Diagnostic observers do not control timing. */
    }
  };
}

/** The sample of an image whose timing failed: every duration null, the reason named. One shape
 *  for the two ways it fails, so a field added to the sample cannot reach one and miss the other. */
export const failedSample = (
  frame: number,
  truncated: boolean,
  error: string,
): GpuTimingSample => ({
  frame,
  totalMs: null,
  frameMs: null,
  frameMsReason: 'failed',
  pairs: { valid: 0, unwritten: 0, invalid: 0 },
  submittedMs: null,
  hostGapMs: null,
  idleBetweenMs: null,
  passes: [],
  truncated,
  error,
});

export function timingEntries(parts: Iterable<TimingPart>, initialTruncated: boolean) {
  let truncated = initialTruncated;
  let unresolvedParts = 0;
  const entries: TimingEntry[] = [];
  for (const part of [...parts].sort((a, b) => a.slot - b.slot)) {
    if (!part.resolved) {
      if (part.names.length) {
        truncated = true;
        unresolvedParts++;
      }
      continue;
    }
    for (let i = 0; i < part.names.length; i++)
      entries.push({ slot: part.base + i * 2, name: part.names[i], part: part.slot });
  }
  return { entries, truncated, unresolvedParts };
}

export type TimingEntry = { slot: number; name: string; part: number };

/**
 * Sets each timed pass's own share of the image, ms: its span less what a pass the queue ran before
 * it already covered (#1279). A device that overlaps passes reports each one's whole span, so their
 * durations add up past the image; these shares count an overlap once, on the pass submitted first,
 * and add up to the time the timed passes cover. `timed` is in the queue's order — the parts as the
 * image submits them, each one's passes as encoded —, never sorted by beginning: a tiled GPU
 * begins a render pass at its vertex stage, ahead of a compute pass submitted before it, whose
 * whole span it would then take.
 */
function setOwnShares(timed: { pass: { ownMs: number }; begin: bigint; end: bigint }[]) {
  let covered = 0n;
  for (const { pass, begin, end } of timed) {
    pass.ownMs = nanosecondsToMs(Number(addedNs(begin, end, covered)));
    if (end > covered) covered = end;
  }
}

/** What a span adds to the time already covered up to `reach`: the part of it past `reach`, ns. */
function addedNs(begin: bigint, end: bigint, reach: bigint) {
  const from = begin > reach ? begin : reach;
  return end > from ? end - from : 0n;
}

/** The time `spans` cover, ns: spans the device overlaps count once. */
function coveredNs(spans: ImageSpan[]) {
  let covered = 0n,
    reach = 0n;
  for (const { beginNs, endNs } of [...spans].sort((a, b) =>
    a.beginNs < b.beginNs ? -1 : a.beginNs > b.beginNs ? 1 : 0,
  )) {
    covered += addedNs(beginNs, endNs, reach);
    if (endNs > reach) reach = endNs;
  }
  return covered;
}

/** The earliest beginning to the latest end of `spans`, or `null` for none. */
function envelope(spans: ImageSpan[]): ImageSpan | null {
  let image: ImageSpan | null = null;
  for (const { beginNs, endNs } of spans)
    image = image
      ? {
          beginNs: beginNs < image.beginNs ? beginNs : image.beginNs,
          endNs: endNs > image.endNs ? endNs : image.endNs,
        }
      : { beginNs, endNs };
  return image;
}

/**
 * Reconstruct one image from device timestamp pairs without counting host gaps as GPU work. A
 * pass's pair is `unwritten` when neither timestamp is this image's (zero, or the value its slot
 * held at the last read: the driver skipped the pass), `invalid` when only one is, or the end
 * precedes the beginning, and valid otherwise. The span is the earliest beginning to the latest end
 * of the valid pairs alone: passes without one add nothing to it and never void it, and it is null
 * only for a truncated image — a pass went untimed, so its last end is unknown — or one with no
 * valid pair at all. A pass whose pair is invalid may lie outside it, so the span is then a lower
 * bound, and the `span` returned for the idle to the next image (whole or none) is null.
 */
export function summarizeTimestamps(
  entries: TimingEntry[],
  values: BigUint64Array,
  truncated: boolean,
  stale: Stale,
) {
  const pairs: TimingPairs = { valid: 0, unwritten: 0, invalid: 0 };
  // The enclosing span of the image, and of each submission inside it, come from these same
  // timestamps: the earliest beginning to the latest end. Passes the device overlaps are covered
  // once, which a sum of durations cannot claim.
  const submissionSpans = new Map<number, ImageSpan & { passes: number }>();
  /** Whether the timestamp at `slot` is this image's: new to its slot, and a device clock never
   *  reads zero. It records the timestamp in the slot memory: ask once per slot, `stale` first. */
  const wrote = (slot: number, value: bigint) => !stale(slot, value) && value !== 0n;
  const timed: Parameters<typeof setOwnShares>[0] = [];
  const passes = entries.map((entry) => {
    const begin = values[entry.slot],
      end = values[entry.slot + 1],
      // Both asked, never one short-circuited: the memory takes both.
      wroteBegin = wrote(entry.slot, begin),
      wroteEnd = wrote(entry.slot + 1, end);
    // An empty pass the driver skipped wrote nothing, and ran nothing: it has no time of its own,
    // and leaves the image's span as the passes that ran made it.
    if (!wroteBegin && !wroteEnd) {
      pairs.unwritten++;
      return { name: entry.name, gpuMs: null, reason: 'unwritten-timestamps' };
    }
    if (!wroteBegin || !wroteEnd || end < begin) {
      pairs.invalid++;
      return {
        name: entry.name,
        gpuMs: null,
        reason: 'invalid-timestamps',
        beginNs: begin.toString(),
        endNs: end.toString(),
      };
    }
    pairs.valid++;
    const span = submissionSpans.get(entry.part);
    if (!span) submissionSpans.set(entry.part, { beginNs: begin, endNs: end, passes: 1 });
    else {
      if (begin < span.beginNs) span.beginNs = begin;
      if (end > span.endNs) span.endNs = end;
      span.passes++;
    }
    const pass = { name: entry.name, gpuMs: nanosecondsToMs(Number(end - begin)), ownMs: 0 };
    timed.push({ pass, begin, end });
    return pass;
  });
  setOwnShares(timed);
  const total =
    truncated || passes.some((pass) => pass.gpuMs === null)
      ? null
      : passes.reduce((sum, pass) => sum + pass.gpuMs!, 0);
  const spans = [...submissionSpans.values()],
    image = envelope(spans),
    // A truncated image's last timed pass is not its last: its span is no span of the image.
    whole = truncated ? null : image,
    frameMsReason: FrameMsReason | null = truncated ? 'truncated' : image ? null : 'no-valid-pair',
    frameMs = whole && nanosecondsToMs(Number(whole.endNs - whole.beginNs));
  const submissions = [...submissionSpans]
    .sort((a, b) => a[0] - b[0])
    .map(([part, span]) => ({
      part,
      passes: span.passes,
      spanMs: nanosecondsToMs(Number(span.endNs - span.beginNs)),
    }));
  // A submission is one contiguous GPU execution, so the image's GPU time is what the submission
  // spans cover — not `frameMs`, which also holds the host time between two submissions. Two
  // submissions the device overlaps cover their overlap once: never a sum of the spans, which would
  // pass `frameMs` and leave a negative host gap.
  const submittedMs = whole && nanosecondsToMs(Number(coveredNs(spans)));
  const hostGapMs = frameMs === null || submittedMs === null ? null : frameMs - submittedMs;
  // The image's two ends on the device timeline, whole or none: a truncated image's last timed
  // pass is not its last, a pass whose pair cannot be read may be, and the idle to the next image
  // would count the untimed rest (#1451). A skipped pass ran nothing: the passes that ran hold
  // the image's two ends.
  const span = pairs.invalid > 0 ? null : whole;
  return {
    sample: {
      totalMs: total,
      frameMs,
      frameMsReason,
      pairs,
      submittedMs,
      hostGapMs,
      submissions,
      passes,
      truncated,
    },
    span,
  };
}
