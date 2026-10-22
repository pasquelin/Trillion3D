import { spread } from '../../../../math/src/scalar/quantile.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { StatsProfileLine } from '../../../../sdk-core/src/modules/stats/report.ts'
import type { CpuStepSummary } from '../../diagnostic/stage/profiler.ts'
import { CPU_STEP_NAMES, CPU_STEP_STAGES } from '../../frame/render/cpuStepTable.ts'
import { profileAsked } from '../../session/host/debugMode.ts'
import { trim, WINDOW_MS, type Cursor } from './frameSeries.ts'

/**
 * The `?profile` measures of the stats module: what the page asked for with `?profile` in its
 * address and the engine's CPU step window alone cannot give. The frames' clock times every
 * animation-frame callback, the page's own frame hooks are timed, and the physics worker's slowest
 * step of each tick is read; the collector turns the last second of them into rows after the CPU
 * section's remainder, and, when the engine's CPU step window is read, adds the engine's CPU total
 * and its five costliest steps. Nothing of it runs without the flag.
 */

/** The world as far as profiling goes: its frame hooks and, when on, the physics' clocks. */
export interface ProfiledWorld {
  /** Calls `hook` after every frame; returns the function that takes it off. */
  onFrame(hook: (frame: { metrics: FrameMetrics }) => void): () => void
  beforeFrame?(hook: (info: { delta: number; time: number }) => void): unknown
  /** The physics' clocks: `stats.stepMaxMs` is the slowest fixed step of the worker's last tick. */
  physics?: { enabled: boolean; stats: { stepMaxMs: number } }
}

/** The durations of one series and when each was filed, trimmed with a `Cursor` (`frameSeries.ts`). */
interface Series extends Cursor {
  ms: number[]
  /** The arrays filed beside `at`, for `trim`. */
  beside: number[][]
}

const series = (): Series => {
  const ms: number[] = []
  return { at: [], start: 0, ms, beside: [ms] }
}

/** The most durations of a series kept: a second of frames at any rate. */
const KEPT = 1000

/** Engine steps that add up others: those with no stage in the engine's step table, shown as the
 *  total, never ranked beside their parts. */
const SUMS = new Set(CPU_STEP_NAMES.filter((_, index) => CPU_STEP_STAGES[index] === null))

/** The steps the profile ranks by their 95th percentile. */
const COSTLIEST = 5

/** Files `ms` in `list`, forgetting what is older than the window or beyond `KEPT`. */
function keep(list: Series, ms: number) {
  const at = performance.now()
  list.at.push(at)
  list.ms.push(ms)
  if (list.at.length - list.start > KEPT) list.start = list.at.length - KEPT
  trim(list, at - WINDOW_MS, list.beside)
}

/** The durations of `list` filed in the last second before `now`. */
function lastSecond(list: Series, now: number) {
  const taken: number[] = []
  for (let i = list.start; i < list.at.length; i++)
    if (list.at[i] >= now - WINDOW_MS) taken.push(list.ms[i])
  return taken
}

/**
 * One profile's clock: the animation-frame callbacks' time of the frame in progress, a frame's
 * callbacks sharing one timestamp so the frame closes when the next one begins, the page hooks'
 * time, and the last second of each. A frame counts only once `drew` is set by the world. Each
 * `startProfile` has its own, so two profiles never share a frame's sums.
 */
interface Clock {
  frameMs: Series
  hooksMs: Series
  stepMs: Series
  stamp: number
  tick: number
  hooks: number
  drew: boolean
}

const newClock = (): Clock => ({
  frameMs: series(),
  hooksMs: series(),
  stepMs: series(),
  stamp: -1,
  tick: 0,
  hooks: 0,
  drew: false,
})

/** The clocks of the profiles running: the one patched `requestAnimationFrame` feeds them all. */
const clocks = new Set<Clock>()

/**
 * The frames' clock: every animation-frame callback timed for each running profile. An engine
 * session binds `requestAnimationFrame` when it opens, and the engine itself times only the draw of
 * a frame (not the callback around it, nor the page's hooks), so the patch is installed as this
 * module loads under `?profile`, before any world opens: installed later (when stats start) it
 * would miss the callback the session already bound. The patch is one for the page (it cannot be
 * taken off safely); what it times goes to the clocks that run.
 */
function windClock() {
  if (typeof requestAnimationFrame === 'undefined') return
  const request = requestAnimationFrame.bind(globalThis)
  globalThis.requestAnimationFrame = (callback) =>
    request((time) => {
      for (const clock of clocks) {
        if (time === clock.stamp) continue
        if (clock.drew) {
          keep(clock.frameMs, clock.tick)
          keep(clock.hooksMs, clock.hooks)
        }
        clock.tick = clock.hooks = 0
        clock.drew = false
        clock.stamp = time
      }
      const start = performance.now()
      try {
        callback(time)
      } finally {
        const elapsed = performance.now() - start
        for (const clock of clocks) clock.tick += elapsed
      }
    })
}
if (profileAsked()) windClock()

/** A world whose frame hooks are timed: wrapped once for the world's life, however many profiles
 *  start and stop on it, so a hook the page added while wrapped keeps being timed into whichever
 *  profiles run (`users`); with none running, the wrapper times into no clock. */
interface Wrapping {
  users: Set<Clock>
  onFrame: ProfiledWorld['onFrame']
}

const wrappings = new WeakMap<ProfiledWorld, Wrapping>()

/** `world`'s `onFrame` as the engine gave it, never timed: for the hooks that are no page hooks (the
 *  stats collector's own), which the profile's hook time must not count, wrapped world or not. */
export function unprofiledOnFrame(world: ProfiledWorld): ProfiledWorld['onFrame'] {
  return wrappings.get(world)?.onFrame ?? world.onFrame.bind(world)
}

/** Wraps `world`'s frame hooks at the API boundary so that each hook the page adds through it is
 *  timed into every user's clock; the module's own hooks go through `unprofiledOnFrame`. */
function wrap(world: ProfiledWorld): Wrapping {
  const users = new Set<Clock>()
  const timed =
    <Hook extends (...args: never[]) => void>(hook: Hook) =>
    (...args: Parameters<Hook>) => {
      const start = performance.now()
      try {
        hook(...args)
      } finally {
        const elapsed = performance.now() - start
        for (const clock of users) clock.hooks += elapsed
      }
    }
  const onFrame = world.onFrame.bind(world),
    beforeFrame = world.beforeFrame?.bind(world)
  world.onFrame = (hook) => onFrame(timed(hook))
  if (beforeFrame) world.beforeFrame = (hook) => beforeFrame(timed(hook))
  return { users, onFrame }
}

/**
 * Starts profiling `world`: every frame hook the page adds from now on is timed (hooks added before
 * this call are not seen; the stats module's own hooks are never timed), beside the animation-frame callbacks the profile's clock times. `lines`
 * builds the rows of the last second; `stop` ends this profile. The world stays wrapped for its
 * life, so the hooks the page added meanwhile are timed again by the next profile.
 */
export function startProfile(world: ProfiledWorld) {
  const clock = newClock()
  const wrapping = wrappings.get(world) ?? wrap(world)
  wrappings.set(world, wrapping)
  const { users } = wrapping
  users.add(clock)
  clocks.add(clock)
  const unhook = wrapping.onFrame(({ metrics }) => {
    // A held frame drew no image: it files nothing, neither a frame nor a worker step.
    if (metrics.frameHeld) return
    clock.drew = true
    const { physics } = world
    if (physics?.enabled) keep(clock.stepMs, physics.stats.stepMaxMs)
  })
  return {
    lines: (now: number, summary: CpuStepSummary | null) =>
      profileLines(
        {
          frameMs: lastSecond(clock.frameMs, now),
          hooksMs: lastSecond(clock.hooksMs, now),
          stepMs: lastSecond(clock.stepMs, now),
        },
        summary,
      ),
    stop() {
      unhook()
      clocks.delete(clock)
      users.delete(clock)
    },
  }
}

/**
 * The profile rows of one second: the frames' clock (animation-frame callbacks), the page's hooks,
 * the engine's CPU total, its five costliest steps by 95th percentile (sums left out) and the
 * physics worker's step, each as median and 95th percentile; none for what was not measured. The
 * clock's rows come from `taken` alone; `summary`, the engine's CPU step window last read, adds the
 * engine's rows and is null while it is not read.
 */
function profileLines(
  taken: { frameMs: number[]; hooksMs: number[]; stepMs: number[] },
  summary: CpuStepSummary | null,
): StatsProfileLine[] {
  const lines: StatsProfileLine[] = []
  const add = (key: string, figures: { p50: number; p95: number } | null, raw?: boolean) => {
    if (figures && Number.isFinite(figures.p95)) lines.push({ key, raw, ...figures })
  }
  add('profile.cpuFrame', spread(taken.frameMs))
  add('profile.pageHooks', spread(taken.hooksMs))
  if (summary) {
    add('profile.engineCpu', summary.steps.totalMs ?? null)
    Object.entries(summary.steps)
      .filter(([name, { p95 }]) => !SUMS.has(name) && Number.isFinite(p95))
      .sort((a, b) => b[1].p95 - a[1].p95)
      .slice(0, COSTLIEST)
      .forEach(([name, figures]) => add(name.replace(/Ms$/, ''), figures, true))
  }
  add('profile.workerStep', spread(taken.stepMs))
  return lines
}
