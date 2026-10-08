// A frame's timestamps read into passes: each pass's span, its own share (its span less what a pass
// submitted before it already covered), and the idle gap the GPU left before it — the wait, apart
// from the work. A pass the driver wrote no timestamp for is `lost`, never confused with one that
// ran in no time (`empty`): a lost timer says nothing of its pass.

import type { PassWork } from './passWorkHooks.ts'

/** What a pass's timestamps say. `ok`: a span. `empty`: it ran in no time — it encoded no work
 *  (so the driver wrote no timestamp) or its stamps are valid and equal: a real zero. `unknown`: only indirect work, which
 *  may have been of no size — a zero or a lost timer, the GPU alone knows. `lost`: it encoded work
 *  and the driver wrote no timestamp — a timer lost, its pass's time unknown. */
export type PassState = 'ok' | 'empty' | 'unknown' | 'lost'
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

/** The passes `stamps` (ns, two per pass, in submission order) time. Pure: the same stamps give the
 *  same passes. */
export function readPasses(
  stamps: ArrayLike<bigint>,
  passes: readonly ({ label: string; kind: TimedPass['kind']; at: number } & PassWork)[],
  complete: boolean,
): FrameGpu {
  const spans: [number, number][] = []
  let covered = -Infinity,
    first = Infinity
  const read = passes.map(({ label, kind, at, ...work }) => {
    const { calls, indirect } = work
    const begin = Number(stamps[at]) / 1e6,
      end = Number(stamps[at + 1]) / 1e6
    // A pass the driver skipped writes no timestamp: zero, or an end before its beginning.
    if (!(stamps[at] > 0n && end >= begin)) {
      const state = calls ? ('lost' as const) : indirect ? ('unknown' as const) : ('empty' as const)
      return { label, kind, ms: 0, spanMs: 0, gapMs: 0, beginMs: Number.NaN, state, work }
    }
    first = Math.min(first, begin)
    const gapMs = Number.isFinite(covered) ? Math.max(0, begin - covered) : 0
    const ms = Math.max(0, end - Math.max(begin, covered))
    spans.push([begin, end])
    covered = Math.max(covered, end)
    const state = end - begin < EMPTY_MS ? ('empty' as const) : ('ok' as const)
    return { label, kind, ms, spanMs: end - begin, gapMs, beginMs: begin, state, work }
  })
  for (const pass of read)
    pass.beginMs = Number.isNaN(pass.beginMs) ? pass.beginMs : pass.beginMs - first
  const unionMs = unionOf(spans)
  const windowMs = spans.length ? covered - first : 0
  return { passes: read, unionMs, gapMs: Math.max(0, windowMs - unionMs), windowMs, complete }
}
