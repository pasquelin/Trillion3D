import { MIB } from '../../../../math/src/constants.ts'
import { mean, quantileOf } from '../../../../math/src/scalar/quantile.ts'
import { clamp, saturate } from '../../../../math/src/scalar/reals.ts'
import type { FrameMetrics } from '../../contracts/metrics.ts'
import { frameStatistics } from '../../runtime/stats.ts'
import {
  MEMORY_KINDS,
  SCENE_ROWS,
  SHADOW_COUNTS,
  SHADOW_TIME_COUNTERS,
  STATS_COUNTERS,
  STATS_TABS,
  type StatsTab,
  type StatsUnitKind,
} from './counters.ts'

/**
 * The stats report: the last second of the world turned into the numbers the profiler panel shows.
 * Pure: it reads a window of samples and returns rows, with no clock, no DOM and no GPU. Every
 * section adds up to its total through a remainder row that is always present, rows keep a fixed
 * order and are never sorted or dropped, and every value is a mean over the window
 * (GPU and shadows) or a median (CPU).
 */

export interface StatsRow {
  /** Stable id: a `words.ts` key, or a GPU pass's own name when `raw`. */
  readonly key: string
  readonly raw?: boolean
  /** Mean over the last second (median for the CPU rows); null = not measured (shown `—`). */
  readonly value: number | null
  /** Max over the last second (times only), null otherwise. */
  readonly max: number | null
  readonly unit: StatsUnitKind
  /** Bar: value / section total, 0..1; null for counters. */
  readonly share: number | null
  /** The section's remainder row. */
  readonly remainder?: boolean
  /** The 95th percentile beside `value` (its median) for a profile row, null when not measured. */
  readonly p95?: number | null
  /** A `?profile` row: a measure of its own, outside the section's sum, share and remainder. */
  readonly profile?: boolean
  /** The number a row's label names (`page.view.<index>` is "view <n>"): the label is the key's
   *  words with `{n}` replaced. */
  readonly n?: number
  /** A GPU stage's passes, in first-seen order. */
  readonly children?: readonly StatsRow[]
  /** A GPU pass row that sums several numbered passes of one family: how many. */
  readonly count?: number
}

export interface StatsSection {
  readonly id: StatsTab
  readonly total: number | null
  readonly unit: StatsUnitKind
  /** Shadows: their times are inside the GPU total. */
  readonly includedIn?: 'gpu'
  readonly rows: readonly StatsRow[]
}

/** The always-visible summary. */
interface StatsSummary {
  readonly fps: number | null
  /** The median frame time of the window. */
  readonly frameMs: number | null
  /** The GPU time, the last one measured when `gpuLast` or `held`. */
  readonly gpuMs: number | null
  /** `gpuMs` of this frame's own image: null when `held` or `gpuLast`. */
  readonly gpuNowMs: number | null
  /** The median main-thread time of a frame over the window: the engine's CPU total is its own
   *  (`cpu` section). */
  readonly cpuMs: number | null
  /** frameMs − max(gpuMs, cpuMs), ≥ 0: time waiting for the display. */
  readonly waitMs: number | null
  readonly refreshMs: number | null
  /** The GPU's idle before its last measured image (`gpuIdleMs`), ms; null unmeasured. */
  readonly gpuIdleMs: number | null
  /** The watched world's place among the page's worlds, from 0 (the first made is the main
   *  view), and how many worlds the page has; the panel names them when there are several. */
  readonly worldIndex: number
  readonly worldCount: number
  /** The engine's bottleneck verdict id (`bottleneck.<id>` in the words), null unmeasured. */
  readonly bottleneck: string | null
  /** No frame drawn in the last second (the window holds none). */
  readonly held: boolean
  /** The GPU time is an earlier image's (held image / no timestamp sample yet). */
  readonly gpuLast: boolean
  /** The refreshes an image typically stayed on screen over the window: the median interval over
   *  the refresh, rounded, at least 1; null without a measured interval or a refresh. */
  readonly refreshesPerImage: number | null
  /** Share of frames per refreshes held: 1, 2, 3, 4, 5+ → fps = (1000 / refreshMs) / n (5+ shown "≤ fps"). */
  readonly cadence: readonly {
    readonly refreshes: number
    readonly fps: number
    readonly share: number
  }[]
}

export interface StatsReport {
  readonly summary: StatsSummary
  readonly sections: readonly StatsSection[] // in STATS_TABS order, only the parts switched on
}

/** One GPU device sample (sampled every few images): the image's time and each pass's own share, classified. */
export interface StatsGpuSample {
  readonly frameMs: number
  /** The shadow `…Ms` counters of the image the sample was taken on, by frame metric field. */
  readonly shadowMs: Readonly<Record<string, number>>
  /** Each timed pass: its label, its stage (null when no declaration names it), its own share (`passOwnMs`). */
  readonly passes: readonly {
    readonly name: string
    readonly stage: string | null
    readonly ms: number
  }[]
}

/** What the page section reads of a world beside the watched one: the last second. */
export interface StatsWorldFigures {
  /** Frames a second drawn in the last second; null with fewer than two frames (held). */
  readonly fps: number | null
  /** Its last GPU frame time, ms. */
  readonly gpuMs: number | null
  /** The GPU time its other views' images took over the last second, ms; null with no view. */
  readonly viewsGpuMs: number | null
  /** The median main-thread frame time, ms. */
  readonly cpuMs: number | null
}

/** The page's figures behind the `page` section: the other worlds and the watched one's views. */
interface StatsPageWindow {
  /** The watched world's frames a second over the last second, counted as the other worlds' are;
   *  null with fewer than two frames. */
  readonly fps: number | null
  /** The watched world's last GPU frame time, ms. */
  readonly gpuMs: number | null
  /** The GPU time of its views beside the main one over the last second, ms; null with none. */
  readonly viewsGpuMs: number | null
  /** Each view beside the main one's last GPU frame time, by the view's index (a hole is null). */
  readonly views: readonly (number | null)[]
  /** The page's other worlds. */
  readonly others: readonly StatsWorldFigures[]
}

/** A `?profile` measure: a median and a 95th percentile over the last second, ms. `raw` where
 *  `key` is an engine step's own name. */
export interface StatsProfileLine {
  readonly key: string
  readonly raw?: boolean
  readonly p50: number
  readonly p95: number
}

/** What the collector hands the report: the last second of the world. */
export interface StatsWindow {
  /** Each drawn frame's rafIntervalMs, NaN unmeasured. */
  readonly intervalsMs: readonly number[]
  readonly refreshMs: number | null
  /** The median main-thread frame time over the window's frames, ms; null before a frame. */
  readonly cpuMs: number | null
  /** The median of the engine's whole-image CPU time over the step window the stages come from,
   *  ms; null when the window was not read. */
  readonly cpuTotalMs: number | null
  /** Every CPU stage of the engine, in its order, by `words.ts` key (`cpu.<stage>`), ms: the sum of
   *  its steps' medians over the engine's step window, 0 when none ran, null when the window was
   *  not read. */
  readonly cpuStages: readonly (readonly [key: string, ms: number | null])[]
  /** GPU samples of the last second, oldest first; the last sample alone when none fell in it. */
  readonly gpu: readonly StatsGpuSample[]
  /** GPU stages to show, in pipeline order: every stage seen since the start (sticky). Unclassified
   *  passes go to stage key 'unclassified', last before the remainder. */
  readonly gpuStages: readonly string[]
  /** Pass names seen since the start, per stage, first-seen order (sticky). */
  readonly gpuPassesSeen: Readonly<Record<string, readonly string[]>>
  /** The last frame's counters (shadow counters, memory, scene). */
  readonly last: FrameMetrics
  /** The GPU's idle before the last measured image, ms; null unmeasured. */
  readonly gpuIdleMs: number | null
  /** The watched world's place among the page's worlds and their number. */
  readonly world: { readonly index: number; readonly count: number }
  /** The page's other worlds and the watched one's views; null when the section is not read. */
  readonly page: StatsPageWindow | null
  /** The `?profile` measures shown after the CPU rows, in order; none without the flag. */
  readonly profile: readonly StatsProfileLine[]
  /** The triangles of the scene's visible meshes, counted by the page, used when the frame
   *  publishes no selected triangles; null when not counted. */
  readonly sceneTriangles: number | null
  readonly held: boolean
  readonly gpuLast: boolean
}

/** What the report hands the engine's bottleneck verdict: the window's figures. */
interface StatsDiagnosis {
  /** The stutters among the window's frame intervals. */
  readonly stutters: number
  readonly cpuMs: number | null
  /** The GPU time deciding the verdict: null for a held or earlier image. */
  readonly gpuNowMs: number | null
  readonly cpuSubmitMs: number | null
  readonly pagesLoading: number
  readonly refreshMs: number | null
}

export type StatsParts = { readonly [T in StatsTab]: boolean } & { readonly panel: boolean }

/** Refreshes a frame held that the cadence counts apart: this many and more are one bucket. */
export const CADENCE_BUCKETS = 5

/** The GPU stage key of a pass no declaration names. */
export const UNCLASSIFIED = 'unclassified'

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0)
const share = (value: number | null, total: number | null) =>
  value === null || total === null || !(total > 0) ? null : saturate(value / total)
const mib = (bytes: number | null | undefined) => (typeof bytes === 'number' ? bytes / MIB : null)

/** A row of a time or a size: its mean and share of `total`. */
const measured = (
  key: string,
  value: number | null,
  max: number | null,
  unit: StatsUnitKind,
  total: number | null,
  extra?: Partial<StatsRow>,
): StatsRow => ({ key, value, max, unit, share: share(value, total), ...extra })

/** The remainder row of a section: what its total holds beyond its rows, clamped at 0, and null when
 *  the total or no row was measured. */
function remainderRow(
  key: string,
  total: number | null,
  rows: readonly StatsRow[],
  unit: StatsUnitKind,
): StatsRow {
  const measuredRows = rows.filter((row) => row.value !== null)
  const value =
    total === null || measuredRows.length === 0
      ? null
      : Math.max(0, total - sum(measuredRows.map((row) => row.value!)))
  return measured(key, value, null, unit, total, { remainder: true })
}

/** The sum and the highest of a figure over the window's samples. */
interface Tally {
  sum: number
  max: number
}

/** A row of a tally over `count` samples: the mean (a sample lacking the figure counts 0) and the
 *  highest, null when no sample was taken. */
function tallyRow(
  key: string,
  tally: Tally | undefined,
  count: number,
  total: number | null,
  extra?: Partial<StatsRow>,
): StatsRow {
  const { sum: all, max } = tally ?? { sum: 0, max: 0 }
  return measured(key, count ? all / count : null, count ? max : null, 'ms', total, extra)
}

/** A pass's group: its label without the number of the chunk, light or set it works on
 *  (`vsm.render.cull 12` → `vsm.render.cull`), so the passes of one family read as one row. */
const passGroup = (name: string) => name.replace(/\s+\d+$/, '')

/** The GPU section: each stage of the pipeline by the mean over the window's samples of its passes'
 *  own shares (a pass or stage a sample lacks counts 0, in the mean and the max), the passes inside
 *  it, then what the image holds beyond the timed passes. The stages and passes are the window's
 *  sticky lists. */
function gpuSection(window: StatsWindow, total: number | null): StatsSection {
  const { gpu } = window
  const stages = new Map<string, Tally & { passes: Map<string, Tally> }>()
  const add = (tally: Tally, ms: number) => {
    tally.sum += ms
    if (ms > tally.max) tally.max = ms
  }
  for (const sample of gpu) {
    const own = new Map<string, Map<string, number>>()
    for (const { name, stage, ms } of sample.passes) {
      const key = stage ?? UNCLASSIFIED
      let passes = own.get(key)
      if (!passes) own.set(key, (passes = new Map()))
      const group = passGroup(name)
      passes.set(group, (passes.get(group) ?? 0) + ms)
    }
    for (const [key, passes] of own) {
      let stat = stages.get(key)
      if (!stat) stages.set(key, (stat = { sum: 0, max: 0, passes: new Map() }))
      let stageMs = 0
      for (const [name, ms] of passes) {
        let pass = stat.passes.get(name)
        if (!pass) stat.passes.set(name, (pass = { sum: 0, max: 0 }))
        add(pass, ms)
        stageMs += ms
      }
      add(stat, stageMs)
    }
  }
  const rows = window.gpuStages.map((stage) => {
    const stat = stages.get(stage)
    const groups = new Map<string, number>()
    for (const name of window.gpuPassesSeen[stage] ?? []) {
      const group = passGroup(name)
      groups.set(group, (groups.get(group) ?? 0) + 1)
    }
    const children = [...groups].map(([group, count]) =>
      tallyRow(group, stat?.passes.get(group), gpu.length, total, { raw: true, count }),
    )
    return tallyRow(`gpu.${stage}`, stat, gpu.length, total, { children })
  })
  rows.push(remainderRow('gpu.untimed', total, rows, 'ms'))
  return { id: 'gpu', total, unit: 'ms', rows }
}

/** The CPU section: the stages the collector hands over, in its order, then the rest of the frame,
 *  then the `?profile` rows when the page asked for them. The stages and the total are medians over
 *  the same step window. The total is the engine's whole-image time (`totalMs`), which stops before
 *  the host's own steps (arrivals, pending, retain, submit) are sampled, so the stages can exceed
 *  it: the total is then their sum, and the rest row is never negative. Both are null when the
 *  window was not read. The profile rows are measures of their own, outside the sum. */
function cpuSection(window: StatsWindow): StatsSection {
  const read = window.cpuStages.filter(([, ms]) => ms !== null)
  // A read without the whole-image time still has its stages: the total is then their sum.
  const total = read.length
    ? Math.max(window.cpuTotalMs ?? 0, sum(read.map(([, ms]) => ms!)))
    : window.cpuTotalMs
  const rows = window.cpuStages.map(([key, ms]) => measured(key, ms, null, 'ms', total))
  rows.push(remainderRow('cpu.rest', total, rows, 'ms'))
  // The profile rows are measures of their own: after the remainder, outside the sum and shares.
  for (const { key, raw, p50, p95 } of window.profile)
    rows.push({ key, raw, value: p50, p95, max: null, unit: 'ms', share: null, profile: true })
  return { id: 'cpu', total, unit: 'ms', rows }
}

type Counter = (typeof STATS_COUNTERS)[number]

/** The row of a counter from the last frame: a size in MiB, null when the frame does not publish it. */
function counterRow(
  { field, key, unit }: Counter,
  last: FrameMetrics,
  total: number | null = null,
): StatsRow {
  const value = last[field]
  return measured(key, unit === 'MiB' ? mib(value) : (value ?? null), null, unit, total)
}

/** The shadows section: the passes' times in the table's order, as means over the window, then the
 *  counters (the light count is the scene's, the pool's bytes the memory's). */
function shadowsSection(window: StatsWindow): StatsSection {
  const { last } = window
  const times = SHADOW_TIME_COUNTERS.map(({ field, key }) => {
    const samples = window.gpu.flatMap((sample) => sample.shadowMs[field] ?? [])
    const value = samples.length ? mean(samples) : (last[field] ?? null)
    return { key, value, max: samples.length ? Math.max(...samples) : value }
  })
  const measuredTimes = times.filter((time) => time.value !== null)
  const total = measuredTimes.length ? sum(measuredTimes.map((time) => time.value!)) : null
  const rows = times.map((time) => measured(time.key, time.value, time.max, 'ms', total))
  return {
    id: 'shadows',
    total,
    unit: 'ms',
    includedIn: 'gpu',
    rows: [...rows, ...SHADOW_COUNTS.map((c) => counterRow(c, last))],
  }
}

/** The memory section: the GPU memory the engine holds by kind, then every other resource. */
function memorySection(last: FrameMetrics): StatsSection {
  const total = mib(last.gpuAllocatedBytes)
  const rows = MEMORY_KINDS.map((c) => counterRow(c, last, total))
  rows.push(remainderRow('memory.other', total, rows, 'MiB'))
  return { id: 'memory', total, unit: 'MiB', rows }
}

/** The scene section: what the cut selected and drew, the pages and the pool, the lights. A frame
 *  that publishes no selected triangles gets the page's own count of the scene's visible
 *  triangles after the drawn ones. */
function sceneSection(window: StatsWindow): StatsSection {
  const { last } = window
  const rows = SCENE_ROWS.map((c) => counterRow(c, last))
  if (last.selectedTriangles == null && window.sceneTriangles != null) {
    const drawn = rows.findIndex((row) => row.key === 'scene.trianglesDrawn')
    rows.splice(
      drawn + 1,
      0,
      measured('scene.trianglesScene', window.sceneTriangles, null, 'count', null),
    )
  }
  return { id: 'scene', total: null, unit: 'count', rows }
}

/** The page section: how busy all the page's worlds keep the GPU and the main thread, as a share
 *  of each second (Σ msᵢ·fpsᵢ / 1000 ms: each world's last GPU frame time and median CPU frame
 *  time times the frames it drew in the last second, so a held world costs nothing; the CPU's adds
 *  up, the worlds sharing one main thread; past 100 % the GPU times overlap). The GPU time of a
 *  world's views beside its main one over the second is added, and each of the watched world's
 *  views shows its last GPU frame time and its share of the world's frame, `view 2` the first
 *  beside the main one. None on a page of one world of one view. */
function pageSection(page: StatsPageWindow, summary: StatsSummary): StatsSection | null {
  if (page.others.length === 0 && page.views.length === 0) return null
  const watched: StatsWorldFigures = {
    fps: page.fps,
    gpuMs: page.gpuMs,
    viewsGpuMs: page.viewsGpuMs,
    cpuMs: summary.cpuMs,
  }
  let gpu: number | null = null,
    cpu: number | null = null
  for (const world of [watched, ...page.others]) {
    const fps = world.fps ?? 0
    if (world.gpuMs != null) gpu = (gpu ?? 0) + world.gpuMs * fps
    if (world.viewsGpuMs != null) gpu = (gpu ?? 0) + world.viewsGpuMs
    if (world.cpuMs != null) cpu = (cpu ?? 0) + world.cpuMs * fps
  }
  const busy = (key: string, msPerSecond: number): StatsRow => ({
    key,
    value: msPerSecond / 10,
    max: null,
    unit: '%',
    share: saturate(msPerSecond / 1000),
  })
  const rows: StatsRow[] = []
  if (gpu !== null) rows.push(busy('page.gpuBusy', gpu))
  if (cpu !== null) rows.push(busy('page.cpuBusy', cpu))
  const frame = page.views.reduce<number>((total, ms) => total + (ms ?? 0), page.gpuMs ?? 0)
  page.views.forEach((ms, index) => {
    if (ms != null)
      rows.push({
        ...measured(`page.view.${index}`, ms, null, 'ms', frame),
        n: index + 2,
      })
  })
  return rows.length ? { id: 'page', total: null, unit: '%', rows } : null
}

/** The refreshes an image typically stayed on screen: the median of the measured intervals over
 *  the refresh, rounded, at least 1; null without a measured interval or a refresh. */
function refreshesPerImageOf(intervals: readonly number[], refreshMs: number | null) {
  if (!refreshMs || !(refreshMs > 0)) return null
  const median = quantileOf(
    intervals.filter((interval) => Number.isFinite(interval) && interval > 0),
    0.5,
  )
  return median === null || median === undefined
    ? null
    : Math.max(1, Math.round(median / refreshMs))
}

/** The share of the window's frames per refreshes held, 1 to `CADENCE_BUCKETS` (the last one and
 *  more); none without a measured interval or a refresh. */
function cadenceOf(
  intervals: readonly number[],
  refreshMs: number | null,
): StatsSummary['cadence'] {
  if (!refreshMs || !(refreshMs > 0)) return []
  const held = new Array<number>(CADENCE_BUCKETS).fill(0)
  let counted = 0
  for (const interval of intervals) {
    if (Number.isNaN(interval)) continue
    held[clamp(Math.round(interval / refreshMs), 1, CADENCE_BUCKETS) - 1]++
    counted++
  }
  return counted
    ? held.map((n, i) => ({
        refreshes: i + 1,
        fps: 1000 / refreshMs / (i + 1),
        share: n / counted,
      }))
    : []
}

/**
 * The report of `window` for the parts switched on: the summary, then one section per tab present,
 * in `STATS_TABS` order. GPU and shadows values are means over the window, CPU values medians; each section's rows and remainder
 * add up to its total. The bottleneck verdict (its id) is `diagnose` over the figures the summary
 * already holds, so no number is computed twice; it is null when neither the CPU nor the current
 * GPU time is known.
 */
export function statsReport(
  window: StatsWindow,
  parts: StatsParts,
  diagnose: (input: StatsDiagnosis) => string,
): StatsReport {
  const { last, refreshMs } = window
  const { fps, p50Ms: frameMs, stutters } = frameStatistics(window.intervalsMs)
  const gpuMs = window.gpu.length
    ? mean(window.gpu.map((s) => s.frameMs))
    : (last.gpuFrameMs ?? null)
  const cpuMs = window.cpuMs
  // A held or earlier image's GPU time is shown as the last one measured but decides nothing.
  const gpuNow = window.held || window.gpuLast ? null : gpuMs
  const busy = gpuNow === null && cpuMs === null ? null : Math.max(gpuNow ?? 0, cpuMs ?? 0)
  const summary: StatsSummary = {
    fps,
    frameMs,
    gpuMs,
    gpuNowMs: gpuNow,
    cpuMs,
    waitMs: frameMs === null || busy === null ? null : Math.max(0, frameMs - busy),
    refreshMs,
    gpuIdleMs: window.gpuIdleMs,
    worldIndex: window.world.index,
    worldCount: window.world.count,
    bottleneck:
      cpuMs === null && gpuNow === null
        ? null
        : diagnose({
            stutters: stutters ?? 0,
            cpuMs,
            gpuNowMs: gpuNow,
            cpuSubmitMs: last.cpuSubmitMs ?? null,
            pagesLoading: last.pagesLoading ?? 0,
            refreshMs,
          }),
    held: window.held,
    gpuLast: window.gpuLast,
    refreshesPerImage: refreshesPerImageOf(window.intervalsMs, refreshMs),
    cadence: cadenceOf(window.intervalsMs, refreshMs),
  }
  const builders: { readonly [T in StatsTab]: () => StatsSection | null } = {
    page: () => (window.page ? pageSection(window.page, summary) : null),
    gpu: () => gpuSection(window, gpuMs),
    cpu: () => cpuSection(window),
    shadows: () => shadowsSection(window),
    memory: () => memorySection(last),
    scene: () => sceneSection(window),
  }
  const sections = STATS_TABS.filter((tab) => parts[tab]).flatMap((tab) => builders[tab]() ?? [])
  return { summary, sections }
}
