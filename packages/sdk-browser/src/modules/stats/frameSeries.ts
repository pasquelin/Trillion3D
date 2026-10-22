import { quantileOf } from '../../../../math/src/scalar/quantile.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { frameStatistics } from '../../../../sdk-core/src/runtime/stats.ts'

/** The window the stats module keeps and reports, ms: its means, maxima and rates are over the last second. */
export const WINDOW_MS = 1000

/** Where a series' live window starts: its timestamps and the index of the oldest one kept. */
export interface Cursor {
  readonly at: number[]
  start: number
}

/** Moves `cursor` past the entries older than `before`, and drops them from `at` and the arrays
 *  filed beside it (one splice) only once they are more than half of what is held. */
export function trim(cursor: Cursor, before: number, beside: unknown[][]) {
  const { at } = cursor
  while (cursor.start < at.length && at[cursor.start] < before) cursor.start++
  if (cursor.start * 2 <= at.length) return
  at.splice(0, cursor.start)
  for (const list of beside) list.splice(0, cursor.start)
  cursor.start = 0
}

/** The views of a frame that has none: one frozen list for every missing view. */
const EMPTY: NonNullable<FrameMetrics['views']> = Object.freeze([])

/** A view's last GPU time, and when the view was last listed by a drawn frame. */
interface ViewSeen {
  ms: number | null
  at: number
}

/**
 * The frames one world drew over the last second: each drawn frame's time, rAF interval and
 * main-thread time, the last GPU time of each of its views beside the main one (by the view's
 * index; a view a frame leaves out keeps its time, one no frame listed for the window is gone), and
 * the world's last GPU time. A held frame drew no new image: it is no frame of the series (fps, CPU time, stutter, views),
 * and the first image after one ends a stretch the engine chose not to draw, so its interval is
 * filed unmeasured; a long interval of a page that keeps drawing is a real freeze and counts.
 */
export function frameSeries() {
  const drawn: Cursor = { at: [], start: 0 },
    intervalsMs: number[] = [],
    cpuFrames: number[] = [],
    viewSeen: Cursor = { at: [], start: 0 },
    viewMs: number[] = []
  let held = false,
    gpuMs: number | null = null
  // Each view's last time by `ViewFrameMetrics.index`; the engine lists only the views a frame drew.
  const viewLast = new Map<number, ViewSeen>()
  return {
    /** Files a frame's metrics seen at `at`; false when the frame was held and drew nothing. */
    push(metrics: FrameMetrics, at: number) {
      if (metrics.gpuFrameMs != null) gpuMs = metrics.gpuFrameMs
      if (metrics.frameHeld) {
        held = true
        return false
      }
      drawn.at.push(at)
      intervalsMs.push(held ? Number.NaN : (metrics.rafIntervalMs ?? Number.NaN))
      cpuFrames.push(metrics.cpuFrameMs)
      held = false
      const now = metrics.views ?? EMPTY
      for (const view of now) {
        const seen = viewLast.get(view.index)
        if (seen) {
          seen.at = at
          if (view.gpuFrameMs != null) seen.ms = view.gpuFrameMs
        } else viewLast.set(view.index, { ms: view.gpuFrameMs, at })
        viewSeen.at.push(at)
        viewMs.push(view.gpuFrameMs ?? 0)
      }
      return true
    },
    /** Keeps only the last second before `now`. */
    trim(now: number) {
      const before = now - WINDOW_MS
      trim(drawn, before, [intervalsMs, cpuFrames])
      trim(viewSeen, before, [viewMs])
      for (const [index, seen] of viewLast) if (seen.at < before) viewLast.delete(index)
    },
    /** The views' last GPU times by view index, a hole (a view not listed in the window, or never
     *  timed) null; a view no frame listed for the window is gone. */
    views() {
      const list: (number | null)[] = []
      for (const [index, seen] of viewLast) {
        while (list.length <= index) list.push(null)
        list[index] = seen.ms
      }
      return list
    },
    /** The window's rAF intervals, ms (NaN where unmeasured). */
    intervals: () => intervalsMs.slice(drawn.start),
    /** Whether no image was drawn in the window. */
    idle: () => drawn.at.length === drawn.start,
    /** The window's figures: frames a second (`frameStatistics` over the intervals, as the header's), median CPU time, the views' GPU time summed, and the
     *  last GPU time (kept across held frames). */
    figures: () => ({
      fps: frameStatistics(intervalsMs.slice(drawn.start)).fps,
      cpuMs: quantileOf(cpuFrames.slice(drawn.start), 0.5) ?? null,
      viewsGpuMs:
        viewMs.length > viewSeen.start
          ? viewMs.slice(viewSeen.start).reduce((sum, ms) => sum + ms, 0)
          : null,
      gpuMs,
    }),
  }
}
