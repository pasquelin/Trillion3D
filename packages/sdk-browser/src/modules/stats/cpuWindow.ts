import type { StatsWindow } from '../../../../sdk-core/src/modules/stats/report.ts'
import { WEBGPU_STAGES } from '../../diagnostic/stage/passDeclaration.ts'
import type { CpuStepReader, CpuStepSummary } from '../../diagnostic/stage/profiler.ts'
import { stepsByStage } from '../../diagnostic/stage/stageDeposits.ts'
import { CPU_STEP_NAMES, CPU_STEP_STAGES } from '../../frame/render/cpuStepTable.ts'
import { WINDOW_MS } from './frameSeries.ts'

/**
 * The CPU stages of a frame, in the GPU tab's order (`WEBGPU_STAGES`, those that have steps), each
 * the steps it sums: the grouping the stage profiler builds from the engine's own table
 * (`stepsByStage`), so a step is in exactly one stage and a sum-only step in none. The key of a
 * stage in the report is `cpu.<stage>`.
 */
const CPU_STAGE_LIST = (() => {
  const steps = stepsByStage(CPU_STEP_NAMES, CPU_STEP_STAGES)
  return WEBGPU_STAGES.filter((stage) => steps.has(stage)).map(
    (stage) => [stage, steps.get(stage)!] as const,
  )
})()

/** The window of a CPU step reader stays open this long after the last report, ms: a panel that is
 *  hidden or folded, or a page that stopped reading, does not keep the engine filing rows. */
const CPU_IDLE_MS = 3000

/** The median of `step` in `summary`, null when no image ran it. */
function finiteP50(summary: CpuStepSummary, step: string) {
  const p50 = summary.steps[step]?.p50
  return p50 !== undefined && Number.isFinite(p50) ? p50 : null
}

/** The sum of the medians of `steps` the window holds, 0 for a step that did not run. */
function stageMs(summary: CpuStepSummary, steps: readonly string[]) {
  let sum = 0
  for (const step of steps) sum += finiteP50(summary, step) ?? 0
  return sum
}

/** Every CPU stage unread. */
export const UNREAD_STAGES: StatsWindow['cpuStages'] = CPU_STAGE_LIST.map(([stage]) => [
  `cpu.${stage}`,
  null,
])

/**
 * The collector's CPU step window: opened by the first full report (`keepOpen`), read at most once
 * a second (`read`), closed `CPU_IDLE_MS` after the last report asked for it. `open` is the
 * world's step window maker (absent: nothing to read); `others` are the page's other worlds, let
 * go with the window. The stages and the total come from the one read, so they add up; a read that
 * finds no image leaves both unread.
 */
export function cpuWindow(
  open: (() => CpuStepReader) | undefined,
  others: { stop(): void } | null,
) {
  let steps: CpuStepReader | null = null,
    readAt = performance.now(),
    stopped = false,
    idleTimer: ReturnType<typeof setTimeout> | undefined,
    // The last one-second read: the stages and the total, null = not read.
    stages: StatsWindow['cpuStages'] = UNREAD_STAGES,
    totalMs: number | null = null,
    // The step window as last read, null = not read.
    summary: CpuStepSummary | null = null

  const close = () => {
    clearTimeout(idleTimer)
    idleTimer = undefined
    steps?.close()
    steps = null
    others?.stop()
  }
  return {
    /** Keeps the readers open for a report that wants them: the step window, opened by the first
     *  one (its stages unread until a second has passed), and the watches of the page's other
     *  worlds; both closed when no report is asked for `CPU_IDLE_MS`, the next one opens them
     *  again. */
    keepOpen(now: number) {
      if (stopped || (!open && !others)) return
      clearTimeout(idleTimer)
      idleTimer = setTimeout(close, CPU_IDLE_MS)
      if (!open || steps) return
      steps = open()
      readAt = now
      stages = UNREAD_STAGES
      totalMs = null
      summary = null
    },
    /** Reads the engine's step window once per second: every stage as the sum of its steps'
     *  medians (0 when none of its steps ran) and the total, from the one read. */
    read(now: number) {
      if (!steps || now - readAt < WINDOW_MS) return
      readAt = now
      const read = steps.read()
      stages = read
        ? CPU_STAGE_LIST.map(([stage, list]) => [`cpu.${stage}`, stageMs(read, list)])
        : UNREAD_STAGES
      totalMs = read ? finiteP50(read, 'totalMs') : null
      summary = read
    },
    stages: () => stages,
    totalMs: () => totalMs,
    summary: () => summary,
    /** Lets the readers go for good. */
    stop() {
      stopped = true
      close()
    },
  }
}
