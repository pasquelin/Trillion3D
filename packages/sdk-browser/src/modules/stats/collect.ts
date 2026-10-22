import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import {
  statsReport,
  type StatsParts,
  type StatsReport,
  type StatsWindow,
} from '../../../../sdk-core/src/modules/stats/report.ts'
import { frameSeries, WINDOW_MS } from './frameSeries.ts'
import { gpuSamples } from './gpuSamples.ts'
import { startProfile, unprofiledOnFrame, type ProfiledWorld } from './profile.ts'
import { sceneTriangles, type StatsSceneNode } from './sceneTriangles.ts'
import { watchWorlds } from './watchWorlds.ts'
import { profileAsked } from '../../session/host/debugMode.ts'
import { diagnoseBottleneck } from '../../diagnostic/frameProfile.ts'
import { FALLBACK_REFRESH_MS } from '../../frame/scale/scaleTargets.ts'
import { WEBGPU_STAGES } from '../../diagnostic/stage/passDeclaration.ts'
import type { CpuStepReader, CpuStepSummary } from '../../diagnostic/stage/profiler.ts'
import { stepsByStage } from '../../diagnostic/stage/stageDeposits.ts'
import { CPU_STEP_NAMES, CPU_STEP_STAGES } from '../../frame/render/cpuStepTable.ts'

/** How often a report is built at most, ms: the collector's cache period, and the panel's refresh. */
export const STATS_PERIOD_MS = 250

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

/** What the collector watches: the frames a world draws and, for the CPU stages, a step window of
 *  its own. */
export interface StatsSource extends ProfiledWorld {
  /** The world's scene: its visible meshes' triangles are counted for the scene section when the
   *  frame publishes no selected triangles. */
  scene?: StatsSceneNode
  /** A CPU step window of the collector's own: `read` summarises the images since its last read and
   *  opens it again; no other reader moves it; `close` stops it filing. */
  openCpuSteps?(): CpuStepReader
}

/** The collector: `report` builds the report of the last second; `stop` takes the frame hook off. */
interface StatsCollector {
  /** The report of the window, at most one per `STATS_PERIOD_MS`; `null` before a frame. The CPU section
   *  is over the engine's step window as of its last one-second read; with `full` false (a folded
   *  panel needs only the summary) the step window is not touched, the CPU stages are unread and
   *  the page's other worlds are not watched. */
  report(full?: boolean): StatsReport | null
  /** Takes the frame hook and the idle timer off, lets the other worlds go and closes the CPU step
   *  window. */
  stop(): void
}

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

/** The page's worlds in a stats report: where the watched one stands among them. */
function worldPlace(world: StatsSource, worlds: readonly StatsSource[]) {
  const index = worlds.indexOf(world)
  // A watched world that is not in the list has no place among them: no tag.
  return index < 0 ? { index: 0, count: 0 } : { index, count: worlds.length }
}

/** Every CPU stage unread. */
const unreadStages: StatsWindow['cpuStages'] = CPU_STAGE_LIST.map(([stage]) => [
  `cpu.${stage}`,
  null,
])

/**
 * Collects what the report is made of. Every frame it files numbers into arrays trimmed to the last
 * second, and nothing else; a GPU sample is filed only when the device handed a new, whole one. The
 * report is built on demand (`report`), at most once per `STATS_PERIOD_MS`, and only for a reader. The CPU
 * step window is open only while full reports are asked for (`CPU_IDLE_MS`), read at most once per
 * second, and the CPU section's stages and total both come from that one read, so they add up; a
 * read that finds no image leaves both unread. The summary's CPU time is the median main-thread
 * frame time of the last second's frames, and the engine's bottleneck verdict
 * (`diagnoseBottleneck`) is taken over the same window. Returns the collector.
 */
export function collectStats(
  world: StatsSource,
  parts: StatsParts,
  worlds?: () => readonly StatsSource[],
): StatsCollector {
  const series = frameSeries(),
    gpu = gpuSamples(parts.shadows)
  let last: FrameMetrics | null = null,
    // The last GPU idle measured: a held image times nothing, the figure stays.
    gpuIdleMs: number | null = null,
    // Images drawn so far, and the count when the scene's triangles were last counted.
    frames = 0,
    countedAt = -1,
    countedTime = Number.NEGATIVE_INFINITY,
    sceneCount: number | null = null,
    refreshMs: number | null = null,
    builtAt = Number.NEGATIVE_INFINITY,
    cpuReadAt = performance.now(),
    // The reader window, open only while someone reads, and the timer that closes it when no one does.
    cpuSteps: CpuStepReader | null = null,
    stopped = false,
    idleTimer: ReturnType<typeof setTimeout> | undefined,
    // The last one-second read of the step window: the stages and the total, null = not read.
    cpuStages: StatsWindow['cpuStages'] = unreadStages,
    cpuTotalMs: number | null = null,
    // The step window as last read, null = not read.
    cpuSummary: CpuStepSummary | null = null,
    cached: StatsReport | null = null,
    cachedFull = false
  const canReadCpu = parts.cpu && world.openCpuSteps !== undefined
  const others = parts.page && worlds ? watchWorlds(world, worlds) : null

  const closeReaders = () => {
    clearTimeout(idleTimer)
    idleTimer = undefined
    cpuSteps?.close()
    cpuSteps = null
    others?.stop()
  }

  // Registered through the unwrapped hook list: the collector's own hook is no page hook, and the profile times none of it.
  const unhook = unprofiledOnFrame(world)(({ metrics }) => {
    const at = performance.now()
    last = metrics
    if (metrics.displayRefreshMs != null) refreshMs = metrics.displayRefreshMs
    if (metrics.gpuIdleMs != null) gpuIdleMs = metrics.gpuIdleMs
    gpu.file(metrics, at)
    if (series.push(metrics, at)) frames++
    series.trim(at)
    gpu.trim(at)
  })
  // The profile rows live in the CPU section: without it nothing is started.
  const profile = profileAsked() && parts.cpu ? startProfile(world) : null

  /** Reads the engine's step window once per second: every stage as the sum of its steps' medians
   *  (0 when none of its steps ran) and the total, from the one read. A read that finds no image
   *  leaves stages and total unread together. */
  const readCpu = (now: number) => {
    if (!cpuSteps || now - cpuReadAt < WINDOW_MS) return
    cpuReadAt = now
    const summary = cpuSteps.read()
    cpuStages = summary
      ? CPU_STAGE_LIST.map(([stage, steps]) => [`cpu.${stage}`, stageMs(summary, steps)])
      : unreadStages
    cpuTotalMs = summary ? finiteP50(summary, 'totalMs') : null
    cpuSummary = summary
  }

  /** Keeps the readers open for a report that wants them: the step window, opened by the first one
   *  (its stages unread until a second has passed), and the watches of the page's other worlds;
   *  both closed when no report is asked for `CPU_IDLE_MS`, the next one opens them again. */
  const keepOpen = (now: number) => {
    if (stopped || (!canReadCpu && !others)) return
    clearTimeout(idleTimer)
    idleTimer = setTimeout(closeReaders, CPU_IDLE_MS)
    if (!canReadCpu || cpuSteps) return
    cpuSteps = world.openCpuSteps!()
    cpuReadAt = now
    cpuStages = unreadStages
    cpuTotalMs = null
    cpuSummary = null
  }

  /** The page section's figures: the other worlds (watched while a full report is asked) and the
   *  watched world's views, null when the page has neither. */
  const pageWindow = (
    now: number,
    { fps, gpuMs, viewsGpuMs }: ReturnType<typeof series.figures>,
  ): StatsWindow['page'] => {
    const watched = others?.read(now) ?? []
    const views = series.views()
    if (!watched.length && !views.length) return null
    return {
      fps,
      gpuMs,
      viewsGpuMs: views.length ? viewsGpuMs : null,
      views: [...views],
      others: watched,
    }
  }

  const report = (full = true) => {
    const now = performance.now()
    if (!last) return null
    if (full) keepOpen(now)
    // A cache a little younger than the period still serves, so a poller on the period never gets
    // a stale report from timer jitter; a summary-only cache does not serve a full read.
    if (cached && (cachedFull || !full) && now - builtAt < STATS_PERIOD_MS * 0.8) return cached
    // Frames of a held image do not come: the window is trimmed here as well.
    series.trim(now)
    gpu.trim(now)
    if (full) readCpu(now)
    // The scene's triangles are counted at most once a second, and only when an image was drawn
    // since the last count.
    if (
      full &&
      parts.scene &&
      last.selectedTriangles == null &&
      world.scene &&
      countedAt !== frames &&
      now - countedTime >= WINDOW_MS
    ) {
      sceneCount = sceneTriangles(world.scene) || null
      countedAt = frames
      countedTime = now
    }
    const figures = series.figures(),
      intervalsMs = series.intervals()
    const { cpuMs } = figures
    cached = statsReport(
      {
        intervalsMs,
        refreshMs,
        cpuMs,
        cpuTotalMs: full ? cpuTotalMs : null,
        cpuStages: full ? cpuStages : unreadStages,
        gpu: gpu.window(),
        gpuStages: gpu.stages(),
        gpuPassesSeen: gpu.passesSeen(),
        last,
        gpuIdleMs,
        world: worldPlace(world, worlds?.() ?? [world]),
        page: full ? pageWindow(now, figures) : null,
        profile: full && profile ? profile.lines(now, cpuSummary) : [],
        sceneTriangles: full ? sceneCount : null,
        held: series.idle(),
        gpuLast: gpu.stale(now),
      },
      parts,
      (input) =>
        diagnoseBottleneck(
          input.stutters,
          input.cpuMs ?? 0,
          input.cpuSubmitMs,
          input.pagesLoading,
          input.gpuNowMs,
          input.refreshMs ?? FALLBACK_REFRESH_MS,
        ).bottleneck,
    )
    builtAt = now
    cachedFull = full
    return cached
  }

  return {
    report,
    stop() {
      stopped = true
      unhook()
      profile?.stop()
      closeReaders()
    },
  }
}
