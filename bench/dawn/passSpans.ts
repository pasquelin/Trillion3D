// A frame's timestamps read into passes: each pass's span, its own share (its span less what a pass
// submitted before it already covered), and the idle gap the GPU left before it — the wait, apart
// from the work. A pass the driver wrote no timestamp for is `lost`, never confused with one that
// ran in no time (`empty`): a lost timer says nothing of its pass.

import type { PassWork } from './passWorkHooks.ts'

/** What a pass's timestamps say. `ok`: a span. `empty`: stamps of no length, or none and no work
 *  encoded (the driver writes no timestamp for a pass that dispatched nothing): a real zero.
 *  `unknown`: no stamps and only indirect work, which may have been of no size. `lost`: no stamps
 *  and direct work encoded: a lost timer, its pass's time unknown. */
type PassState = 'ok' | 'empty' | 'unknown' | 'lost'
/** One timed pass of a frame. `ms`: its own share of the frame's GPU time (the shares add up to
 *  the union). `spanMs`: its begin to its end. `gapMs`: the idle time between what ran before it and
 *  its begin — the GPU waiting for it. `beginMs`: its begin from the frame's first. */
export type TimedPass = {
  label: string
  kind: 'render' | 'compute'
  ms: number
  spanMs: number
  gapMs: number
  beginMs: number
  state: PassState
  /** What the pass encoded (`passWorkHooks.ts`). */
  work: PassWork
}
/** A frame's passes, the union of their spans, the idle between them, and the window they lie in;
 *  `complete` false when the engine timed one of them itself. */
export type FrameGpu = {
  passes: TimedPass[]
  unionMs: number
  gapMs: number
  windowMs: number
  complete: boolean
}

/** A span of fewer ms than this is empty: Dawn's timestamps tick at 1 ns, a real pass takes more. */
const EMPTY_MS = 0.0005

/** The union of `[begin, end]` spans, in their unit. */
export function unionOf(spans: readonly [number, number][]) {
  let total = 0,
    reach = -Infinity
  for (const [begin, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (end <= reach) continue
    total += end - Math.max(begin, reach)
    reach = end
  }
  return total
}

/** The passes `stamps` (ns, two per pass, in encoding order) time. Pure: the same stamps give the
 *  same passes. Shares and waits are told in the order the GPU ran the passes — by begin time —
 *  whichever order they were encoded or submitted in; the passes come back in encoding order. */
export function readPasses(
  stamps: ArrayLike<bigint>,
  passes: readonly ({ label: string; kind: TimedPass['kind']; at: number } & PassWork)[],
  complete: boolean,
): FrameGpu {
  const times = passes.map(({ at }) => ({
    begin: Number(stamps[at]) / 1e6,
    end: Number(stamps[at + 1]) / 1e6,
    stamped: stamps[at] > 0n && stamps[at + 1] >= stamps[at],
  }))
  const read: TimedPass[] = passes.map(({ label, kind, at: _at, ...work }, i) => {
    const { begin, end } = times[i]
    // A pass the driver skipped writes no timestamp: zero, or an end before its beginning.
    const state = work.calls
      ? ('lost' as const)
      : work.indirect
        ? ('unknown' as const)
        : ('empty' as const)
    return { label, kind, ms: 0, spanMs: end - begin, gapMs: 0, beginMs: Number.NaN, state, work }
  })
  const ran = times
    .flatMap((t, i) => (t.stamped ? [i] : []))
    .sort((a, b) => times[a].begin - times[b].begin)
  const first = ran.length ? times[ran[0]].begin : 0
  const spans: [number, number][] = []
  let covered = -Infinity
  for (const i of ran) {
    const { begin, end } = times[i]
    const pass = read[i]
    pass.gapMs = Number.isFinite(covered) ? Math.max(0, begin - covered) : 0
    pass.ms = Math.max(0, end - Math.max(begin, covered))
    pass.spanMs = end - begin
    pass.beginMs = begin - first
    pass.state = end - begin < EMPTY_MS ? 'empty' : 'ok'
    spans.push([begin, end])
    covered = Math.max(covered, end)
  }
  for (const pass of read) if (!(pass.beginMs >= 0)) pass.spanMs = 0
  const unionMs = unionOf(spans)
  const windowMs = spans.length ? covered - first : 0
  return { passes: read, unionMs, gapMs: Math.max(0, windowMs - unionMs), windowMs, complete }
}
