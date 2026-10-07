import type { FrameMetrics } from '../../../../sdk-core/src/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { advanceMixers } from '../../../../sdk-core/src/world/animation/mixer.ts'
import { lendAnimationSampler } from '../../animation/batchAnimation.ts'
import { frameStart } from '../../frame/scheduling.ts'
import { createFrameGrid } from './worldFrameGrid.ts'

/** What the loop steps ahead of a frame: `world.controls`. */
type Stepped = { autoUpdate: boolean; update(delta: number): void }
/** The world's physics as a frame runs it (`worldPhysics.ts`): its time set, then its frame. */
type Physics = { time(seconds: number): void; frame(): boolean }

/** A frame's metrics as the host copied them from the engine, and one a page reads composed from
 *  them; `null` where the path does not count. */
export type WorldFrameMetrics = FrameMetrics & {
  /** Clusters the occlusion test found hidden this frame; `null` where the path does not count them. */
  hizCulled: number | null
}

/** What a frame hook receives: seconds since the last frame and since the world began. The
 *  world's one object, rewritten each frame: a hook that keeps a value copies it. */
export interface FrameInfo {
  /** Seconds the world advanced since the previous frame — what its clips and controllers
   *  integrated —, at most two frame intervals after a pause; 0 on the first. */
  delta: number
  /** Seconds since the world began, at the frame's time (`worldFrameGrid.ts`). */
  time: number
  /** How many frames the world has drawn. */
  frame: number
  /** What the last frame cost: triangles, pages, timings. */
  metrics: WorldFrameMetrics
}

/** What a before-frame hook receives: the seconds the controllers just integrated, and since the
 *  world began. The world's one object, rewritten each frame: a hook that keeps a value copies it. */
export type BeforeFrameInfo = Pick<FrameInfo, 'delta' | 'time'>

/** The engine's metrics with what a page reads composed from them: the clusters the occlusion
 *  test rejected. */
function named(m: FrameMetrics): WorldFrameMetrics {
  return Object.assign(m, {
    hizCulled: m.hizRejectedClusters ?? null,
  })
}

/**
 * What a page reads before the world's first frame: a host-led loop asks for the metrics right
 * after `render()`, which draws nothing until the engine is ready. No frame ran, so nothing was
 * spent, loaded or drawn: the counts that a frame measures are `null`, the totals are zero.
 */
export const NOT_DRAWN: Readonly<WorldFrameMetrics> = Object.freeze({
  rafIntervalMs: null,
  cpuFrameMs: 0,
  cpuSubmitMs: null,
  drawCalls: null,
  triangles: null,
  clusters: null,
  selectedTriangles: null,
  residentPages: null,
  geometryAllocationBytes: null,
  vramBytes: null,
  pageLoads: 0,
  pageBytesRead: 0,
  gpuFrameMs: null,
  hizCulled: null,
})

/**
 * How many display intervals a frame may span and still count as the loop running: one frame
 * drawn late, the one after it on time. A longer gap is a pause — a still scene the loop slept
 * through, a hidden tab — and not time the scene lived. It is a ratio of the display's own
 * interval, not a duration: its only effect on a loop that really slowed down is how fast the
 * measured interval follows it, by this factor per frame.
 */
const LATE_FRAMES = 2

/**
 * THE DELTA IS BOUNDED BY THE DISPLAY'S OWN PACE. The loop sleeps in a still scene and the
 * browser stops it in a hidden tab, so the wall time since the last frame can be seconds long;
 * integrated as such, a held key, a cruising camera or a playing clip would leap. The first frame
 * after a pause therefore spans at most `LATE_FRAMES` of the last interval the loop measured, the
 * interval being the delta it last handed out; the first frame of all spans nothing.
 */
function boundedDelta() {
  let interval: number | null = null
  const pace = {
    /** Whether the last `read` was bounded: a pause, not an interval the loop ran. */
    paused: false,
    /** The seconds a frame `ms` after the last integrates; `first` for the world's first. */
    read: (ms: number, first: boolean) => {
      const raw = first ? 0 : ms / 1000
      pace.paused = interval !== null && raw > LATE_FRAMES * interval
      return pace.paused ? LATE_FRAMES * interval! : raw
    },
    /** A frame drew with `delta`: it is the interval the next pause is bounded by. Two frames
     *  within one clock tick measure nothing, and a zero bound would never grow again. */
    drawn(delta: number) {
      if (delta > 0) interval = delta
    },
  }
  return pace
}

/** Adds `hook` to `hooks`; returns the function that removes it. */
function member<T>(hooks: Set<(info: T) => void>, hook: (info: T) => void) {
  hooks.add(hook)
  return () => {
    hooks.delete(hook)
  }
}

/** The per-frame hooks of a world, in the order they were added: `before` ones ahead of each
 *  drawn frame, the others after it. */
export function createWorldFrames() {
  // The mixers sample through the WebAssembly sampler once the module is there.
  void lendAnimationSampler()
  // The world's time is its frames' (`frameStart`), on the display's grid while it holds one.
  const state: FramesState = {
    hooks: new Set(),
    early: new Set(),
    grid: createFrameGrid(),
    start: frameStart(),
    frame: 0,
    last: null,
    pace: boundedDelta(),
    info: { delta: 0, time: 0, frame: 0, metrics: NOT_DRAWN },
    ahead: { delta: 0, time: 0 },
    steps: { first: true, taken: false, since: 0 },
  }
  const { hooks, early } = state
  return {
    get last() {
      return state.last
    },
    /** Seconds since the last step ahead of a frame, on the display's grid while it holds one
     *  (`worldFrameGrid.ts`), bounded after a pause: what a controller integrates; the step is
     *  taken now. A display frame stepped again advances nothing. */
    advance: () => advance(state),
    /**
     * Adds a function to run after every drawn frame.
     * @param hook - The function to run; it gets the frame's time and metrics.
     * @returns A function that stops the hook.
     */
    add: (hook: (frame: FrameInfo) => void) => member(hooks, hook),
    /**
     * Adds a function to run ahead of every drawn frame.
     * @param hook - The function to run; it gets the seconds just integrated and the world's time.
     * @returns A function that stops the hook.
     */
    before: (hook: (frame: BeforeFrameInfo) => void) => member(early, hook),
    step: (controls: Stepped | null, scene: Object3D, physics: Physics | null = null) =>
      step(state, controls, scene, physics),
    dispatch: (metrics: FrameMetrics) => dispatch(state, metrics),
    clear() {
      hooks.clear()
      early.clear()
    },
  }
}

/** What a world's frames hold between two (`createWorldFrames`). */
type FramesState = {
  hooks: Set<(frame: FrameInfo) => void>
  early: Set<(frame: BeforeFrameInfo) => void>
  grid: ReturnType<typeof createFrameGrid>
  start: number
  frame: number
  last: WorldFrameMetrics | null
  pace: ReturnType<typeof boundedDelta>
  info: FrameInfo
  ahead: BeforeFrameInfo
  /** Whether no step was taken yet, whether one was since the last frame drawn, and the seconds
   *  integrated since then: what that frame's hooks are told, whatever the steps were. */
  steps: { first: boolean; taken: boolean; since: number }
}

/** The controllers integrate from one step to the next, so each frame's render time is lived. */
function advance({ grid, pace, steps }: FramesState) {
  grid.frame(frameStart())
  const seconds = pace.read(grid.delta, steps.first)
  if (pace.paused) grid.restart()
  steps.first = false
  steps.taken = true
  steps.since += seconds
  return seconds
}

/** A frame is about to be drawn, `seconds` after the last: the early hooks run. */
function prepare({ ahead, grid, start, early }: FramesState, seconds: number) {
  ahead.delta = seconds
  ahead.time = (grid.time - start) / 1000
  for (const hook of early) hook(ahead)
}

/**
 * The work ahead of a frame, whoever leads it, in this order: the physics' time is set to the
 * frame's, the controller steps the camera unless the page took the step or leads the frame
 * (`null`) — a character it moves is drawn at that time —, the scene's clips advance, the
 * physics draws its bodies and is owed the same seconds, the early hooks run. What they move
 * is written to the engine after them, so it is drawn in this frame.
 * @returns Whether a clip still plays or a body still moves, and asks for the next frame.
 */
function step(
  state: FramesState,
  controls: Stepped | null,
  scene: Object3D,
  physics: Physics | null,
) {
  const seconds = advance(state)
  physics?.time(seconds)
  if (controls?.autoUpdate) controls.update(seconds)
  const playing = advanceMixers(scene, seconds)
  const moving = physics?.frame() ?? false
  prepare(state, seconds)
  return playing || moving
}

/** A frame was drawn: its hooks are told the seconds the steps since the last one
 *  integrated — a frame drawn without a step takes one now — and the display's refresh the
 *  frame measured places the next on the grid. */
function dispatch(state: FramesState, metrics: FrameMetrics) {
  const { info, steps, pace, grid } = state
  if (!steps.taken) advance(state)
  info.delta = steps.since
  pace.drawn(info.delta)
  steps.taken = false
  steps.since = 0
  info.time = (grid.time - state.start) / 1000
  info.frame = state.frame++
  info.metrics = state.last = named(metrics)
  grid.refreshed(metrics.displayRefreshMs)
  for (const hook of state.hooks) hook(info)
}
