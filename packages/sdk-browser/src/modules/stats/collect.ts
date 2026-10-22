import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import {
  statsReport,
  type StatsParts,
  type StatsReport,
  type StatsWindow,
} from '../../../../sdk-core/src/modules/stats/report.ts'
import { cpuWindow, UNREAD_STAGES } from './cpuWindow.ts'
import { frameSeries, WINDOW_MS } from './frameSeries.ts'
import { gpuSamples } from './gpuSamples.ts'
import { startProfile, unprofiledOnFrame, type ProfiledWorld } from './profile.ts'
import { sceneCounter, type StatsSceneNode } from './sceneTriangles.ts'
import { watchWorlds } from './watchWorlds.ts'
import { profileAsked } from '../../session/host/debugMode.ts'
import { diagnoseBottleneck } from '../../diagnostic/frameProfile.ts'
import { FALLBACK_REFRESH_MS } from '../../frame/scale/scaleTargets.ts'
import type { CpuStepReader } from '../../diagnostic/stage/profiler.ts'

/** How often a report is built at most, ms: the collector's cache period, and the panel's refresh. */
export const STATS_PERIOD_MS = 250

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

/** The page's worlds in a stats report: where the watched one stands among them. */
function worldPlace(world: StatsSource, worlds: readonly StatsSource[]) {
  const index = worlds.indexOf(world)
  // A watched world that is not in the list has no place among them: no tag.
  return index < 0 ? { index: 0, count: 0 } : { index, count: worlds.length }
}

/** The page section's figures: the other worlds (watched while a full report is asked) and the
 *  watched world's views, null when the page has neither. */
function pageWindow(
  others: ReturnType<typeof watchWorlds> | null,
  series: ReturnType<typeof frameSeries>,
  now: number,
  { fps, gpuMs, viewsGpuMs }: ReturnType<ReturnType<typeof frameSeries>['figures']>,
): StatsWindow['page'] {
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

/** The engine's bottleneck verdict over the report's figures. */
const bottleneckOf = (input: Parameters<Parameters<typeof statsReport>[2]>[0]) =>
  diagnoseBottleneck(
    input.stutters,
    input.cpuMs ?? 0,
    input.cpuSubmitMs,
    input.pagesLoading,
    input.gpuNowMs,
    input.refreshMs ?? FALLBACK_REFRESH_MS,
  ).bottleneck

/** What one collector holds: the series it files, the readers it keeps, and the latest frame's
 *  figures (the GPU idle is the last one measured: a held image times nothing). */
interface Collected {
  world: StatsSource
  worlds?: () => readonly StatsSource[]
  series: ReturnType<typeof frameSeries>
  gpu: ReturnType<typeof gpuSamples>
  cpu: ReturnType<typeof cpuWindow>
  scene: ReturnType<typeof sceneCounter>
  others: ReturnType<typeof watchWorlds> | null
  profile: ReturnType<typeof startProfile> | null
  last: FrameMetrics | null
  gpuIdleMs: number | null
  refreshMs: number | null
}

/** The window the report is made of, as of `now`; the CPU, page, profile and scene parts only for
 *  a full report. */
function windowAt(c: Collected, last: FrameMetrics, now: number, full: boolean): StatsWindow {
  const figures = c.series.figures()
  return {
    intervalsMs: c.series.intervals(),
    refreshMs: c.refreshMs,
    cpuMs: figures.cpuMs,
    cpuTotalMs: full ? c.cpu.totalMs() : null,
    cpuStages: full ? c.cpu.stages() : UNREAD_STAGES,
    gpu: c.gpu.window(),
    gpuStages: c.gpu.stages(),
    gpuPassesSeen: c.gpu.passesSeen(),
    last,
    gpuIdleMs: c.gpuIdleMs,
    world: worldPlace(c.world, c.worlds?.() ?? [c.world]),
    page: full ? pageWindow(c.others, c.series, now, figures) : null,
    profile: full && c.profile ? c.profile.lines(now, c.cpu.summary()) : [],
    sceneTriangles: full ? c.scene.count() : null,
    held: c.series.idle(),
    gpuLast: c.gpu.stale(now),
  }
}

/** Files each frame the world draws into `c`. Registered through the unwrapped hook list: the
 *  collector's own hook is no page hook, and the profile times none of it. */
function hookFrames(world: StatsSource, c: Collected) {
  return unprofiledOnFrame(world)(({ metrics }) => {
    const at = performance.now()
    c.last = metrics
    if (metrics.displayRefreshMs != null) c.refreshMs = metrics.displayRefreshMs
    if (metrics.gpuIdleMs != null) c.gpuIdleMs = metrics.gpuIdleMs
    c.gpu.file(metrics, at)
    if (c.series.push(metrics, at)) c.scene.frame()
    c.series.trim(at)
    c.gpu.trim(at)
  })
}

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
  const others = parts.page && worlds ? watchWorlds(world, worlds) : null
  const c: Collected = {
    world,
    worlds,
    series: frameSeries(),
    gpu: gpuSamples(parts.shadows),
    cpu: cpuWindow(parts.cpu ? world.openCpuSteps?.bind(world) : undefined, others),
    scene: sceneCounter(() => world.scene, parts.scene, WINDOW_MS),
    others,
    // The profile rows live in the CPU section: without it nothing is started.
    profile: profileAsked() && parts.cpu ? startProfile(world) : null,
    last: null,
    gpuIdleMs: null,
    refreshMs: null,
  }
  let builtAt = Number.NEGATIVE_INFINITY,
    cached: StatsReport | null = null,
    cachedFull = false

  const unhook = hookFrames(world, c)

  const report = (full = true) => {
    const now = performance.now()
    const { last } = c
    if (!last) return null
    if (full) c.cpu.keepOpen(now)
    // A cache a little younger than the period still serves, so a poller on the period never gets
    // a stale report from timer jitter; a summary-only cache does not serve a full read.
    if (cached && (cachedFull || !full) && now - builtAt < STATS_PERIOD_MS * 0.8) return cached
    // Frames of a held image do not come: the window is trimmed here as well.
    c.series.trim(now)
    c.gpu.trim(now)
    if (full) {
      c.cpu.read(now)
      c.scene.update(now, last.selectedTriangles)
    }
    cached = statsReport(windowAt(c, last, now, full), parts, bottleneckOf)
    builtAt = now
    cachedFull = full
    return cached
  }

  return {
    report,
    stop() {
      unhook()
      c.profile?.stop()
      c.cpu.stop()
    },
  }
}
