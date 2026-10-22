import type { StatsReport } from '../../../../../sdk-core/src/modules/stats/report.ts'
import { STATS_PERIOD_MS } from '../collect.ts'
import type { PanelParts, PanelState } from './build.ts'
import type { Layout } from './layout.ts'
import type { sparkline } from './spark.ts'

/** What the panel's clock reads and drives. */
interface ClockContext {
  parts: PanelParts
  state: PanelState
  layout: Layout
  read: (full: boolean) => StatsReport | null
  render: (report: StatsReport) => void
  spark: ReturnType<typeof sparkline>
  place: () => void
}

/**
 * The panel's timer: a tick reads the latest report and draws it, only while the panel is on a
 * visible page; folded, a tick writes the header alone. `sync` starts or stops the timer by the
 * page's visibility; `stop` clears it.
 */
export function startClock({ parts, state, layout, read, render, spark, place }: ClockContext) {
  const { area, panel } = parts
  const tick = () => {
    // The frame is out of the page or under a closed ancestor: nothing to read or draw. The panel
    // itself starts empty (not displayed), so only its frame says whether the page shows it.
    if (!area.isConnected || state.frameWidth <= 0 || state.frameHeight <= 0) return
    // Folded, the header needs only the summary: the CPU step window is left alone.
    const report = read(!layout.compact)
    // The collector hands the same report until its period ends: nothing to push or draw again.
    if (!report || report === state.latest) return
    state.latest = report
    const first = panel.hasAttribute('data-empty')
    // A held or earlier image's GPU time is not this report's: the sparkline gets a gap.
    spark.push(report.summary.cpuMs, report.summary.gpuNowMs)
    render(report)
    if (first) place()
  }
  let timer: ReturnType<typeof setInterval> | undefined
  const sync = () => {
    const running = !globalThis.document?.hidden
    if (running && timer === undefined) {
      tick()
      timer = setInterval(tick, STATS_PERIOD_MS)
    } else if (!running && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  globalThis.document?.addEventListener('visibilitychange', sync)
  return {
    sync,
    stop() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      globalThis.document?.removeEventListener('visibilitychange', sync)
    },
  }
}
