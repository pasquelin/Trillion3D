import { nanosecondsToMs, type GpuTimingSample } from './types.ts';

export function createSampleEmitter(onSample: (sample: GpuTimingSample) => void) {
  return (sample: GpuTimingSample) => {
    try {
      onSample({ source: 'timestamp-query', ...sample });
    } catch {
      /* Diagnostic observers do not control timing. */
    }
  };
}

import type { TimingPart } from './encoder.ts';

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
 * Each pass's own share of the image, ms, null for a pass without a valid pair: its span less what
 * a pass the device began earlier already covered (#1279). A device that overlaps passes reports
 * each one's whole span, so their durations add up past the image; these shares count an overlap
 * once, on the pass begun first, and add up to the time the timed passes cover.
 */
function ownShares(entries: TimingEntry[], values: BigUint64Array) {
  const shares: (number | null)[] = entries.map(() => null);
  const valid = entries
    .map((entry, at) => ({ at, begin: values[entry.slot], end: values[entry.slot + 1] }))
    .filter(({ begin, end }) => begin !== 0n && end !== 0n && end >= begin)
    .sort((a, b) => (a.begin < b.begin ? -1 : a.begin > b.begin ? 1 : a.at - b.at));
  let covered = 0n;
  for (const { at, begin, end } of valid) {
    const from = begin > covered ? begin : covered;
    shares[at] = nanosecondsToMs(Number(end > from ? end - from : 0n));
    if (end > covered) covered = end;
  }
  return shares;
}

/** Reconstruct one image from device timestamp pairs without counting host gaps as GPU work. */
export function summarizeTimestamps(
  entries: TimingEntry[],
  values: BigUint64Array,
  truncated: boolean,
) {
  let invalidSamples = 0;
  // The enclosing span of the image, and of each submission inside it, come from these same
  // timestamps: the earliest beginning to the latest end. Passes the device overlaps are covered
  // once, which a sum of durations cannot claim.
  let firstBegin = 0n,
    lastEnd = 0n,
    spanValid = true;
  const submissionSpans = new Map<number, { beginNs: bigint; endNs: bigint; passes: number }>();
  const own = ownShares(entries, values);
  const passes = entries.map((entry, at) => {
    const begin = values[entry.slot],
      end = values[entry.slot + 1];
    if (begin === 0n || end === 0n || end < begin) {
      invalidSamples++;
      spanValid = false;
      return {
        name: entry.name,
        gpuMs: null,
        reason: 'invalid-timestamps',
        beginNs: begin.toString(),
        endNs: end.toString(),
      };
    }
    if (firstBegin === 0n || begin < firstBegin) firstBegin = begin;
    if (end > lastEnd) lastEnd = end;
    const span = submissionSpans.get(entry.part);
    if (!span) submissionSpans.set(entry.part, { beginNs: begin, endNs: end, passes: 1 });
    else {
      if (begin < span.beginNs) span.beginNs = begin;
      if (end > span.endNs) span.endNs = end;
      span.passes++;
    }
    return { name: entry.name, gpuMs: nanosecondsToMs(Number(end - begin)), ownMs: own[at]! };
  });

  const total =
    truncated || passes.some((pass) => pass.gpuMs === null)
      ? null
      : passes.reduce((sum, pass) => sum + pass.gpuMs!, 0);
  const frameMs =
    truncated || !spanValid || firstBegin === 0n
      ? null
      : nanosecondsToMs(Number(lastEnd - firstBegin));
  const submissions = [...submissionSpans]
    .sort((a, b) => a[0] - b[0])
    .map(([part, span]) => ({
      part,
      passes: span.passes,
      spanMs: nanosecondsToMs(Number(span.endNs - span.beginNs)),
    }));
  // A submission is one contiguous GPU execution, so the image's GPU time is the sum of the
  // submission spans — not `frameMs`, which also holds the host time between two submissions.
  const submittedMs =
    frameMs === null ? null : submissions.reduce((sum, span) => sum + span.spanMs, 0);
  const hostGapMs = frameMs === null || submittedMs === null ? null : frameMs - submittedMs;
  return {
    sample: { totalMs: total, frameMs, submittedMs, hostGapMs, submissions, passes, truncated },
    invalidSamples,
  };
}
