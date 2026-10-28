import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { ViewFrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { ViewCamera } from '../../camera/world.ts'
import type { EngineView } from '../engine/types.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  temporalAntialiasingLevel,
  type TemporalAntialiasingOption,
} from '../../../../sdk-core/src/contracts/materialOptions.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import { devicePixels, pixelRatioOf } from '../engine/common.ts'
import { capSkips } from '../../frame/cadence.ts'
import { frameStart } from '../../frame/scheduling.ts'
import { SECOND_MS } from '../../frame/scale/scaleTargets.ts'
import type { MeasuredWorld } from '../explorer.ts'
import { copyWorldCamera } from './camera.ts'
import { cameraAdopter } from './link.ts'
import { resolveWorldTarget, type WorldTarget } from './target.ts'
import { joined } from '../../../../sdk-core/src/runtime/joined.ts'

/** A rectangle of the world's canvas, CSS pixels from its top left. */
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

/** What a page may set when it adds a view (`world.addView`); saying nothing but where it draws is
 *  the normal case. */
export interface ViewOptions {
  /** The canvas the view draws into: a canvas, an element to draw inside, or the ID of either. */
  canvas?: WorldTarget
  /** Without `canvas`: the rectangle of the world's own canvas the view is drawn over. */
  viewport?: ViewRect
  /** The camera it looks through; a perspective camera of its own by default. */
  camera?: Camera
  /** Its render scale, as `WorldOptions.renderScale`; `'auto'` follows the world's one budget,
   *  which the whole frame — every view in it — is fitted to. @defaultValue 'auto' */
  renderScale?: RenderScale
  /** Its own temporal antialiasing's level, as `WorldOptions.temporalAntialiasing`.
   *  @defaultValue 'max' */
  temporalAntialiasing?: TemporalAntialiasingOption
  /** The most frames a second it is drawn, as `WorldOptions.maxFrameRate`: a frame of the world it
   *  is not due in leaves it out. @defaultValue Infinity, every frame of the world */
  maxFrameRate?: number
}

/** What a view's frame hook receives: the seconds since the view was last drawn, and what its
 *  image cost and drew. The view's one object, rewritten each frame it is drawn. */
export interface ViewFrameInfo {
  /** Seconds since the view's previous image; 0 on its first. */
  delta: number
  /** What its image cost and drew (`FrameMetrics.views`). */
  metrics: ViewFrameMetrics
}

/** What the world's views read of it: its canvas, its pixel ratio option, a frame asked. */
type WorldOfViews = {
  canvas: HTMLCanvasElement
  pixelRatio: number | undefined
  invalidate: () => void
}

/** One view's state across the world's sessions: the page's settings, and the engine's view in the
 *  open session, made again by each session that opens (`attach`). */
type ViewRecord = {
  options: Required<Pick<ViewOptions, 'renderScale' | 'maxFrameRate'>> & {
    temporalAntialiasing: TemporalAntialiasingLevel
  }
  canvas: HTMLCanvasElement
  release: () => void
  viewport: ViewRect | undefined
  camera: Camera
  handle: EngineView | undefined
  /** The camera of the session the handle was made in, the view's copied onto it. */
  host: ViewCamera | undefined
  size: [number, number]
  /** The world's canvas buffer size a rectangle view was last measured over. */
  measuredOver: [number, number]
  /** The display frame it was last drawn at, ms; `-Infinity` before. */
  drawnAt: number
  hooks: Set<(info: ViewFrameInfo) => void>
  info: ViewFrameInfo | undefined
  observer: ResizeObserver | undefined
  disposed: boolean
  /** What the page holds of it (`worldView`), made once. */
  view: WorldView | undefined
}

/** What the world's views keep: the world, the records in the order they were added, the camera
 *  adopter, the session in place, and the views drawn in the frame under way. */
type ViewsState = {
  world: WorldOfViews
  records: ViewRecord[]
  adopt: ReturnType<typeof cameraAdopter>
  explorer: MeasuredWorld | null
  /** The views drawn in the frame under way, the main view's metrics carry
   *  (`FrameMetrics.views`). */
  drawn: ViewFrameMetrics[]
  /** Their records, beside: a view removed before the hooks run keeps its place. */
  drawnRecords: ViewRecord[]
}

/** The view's drawing buffer, canvas pixels — its own canvas's CSS box at the ratio, or its
 *  rectangle of the world's canvas at that canvas's own scale —, handed to its engine view;
 *  returns the rectangle, for a view over a viewport. */
function measure({ world }: ViewsState, record: ViewRecord) {
  if (!record.viewport) {
    const r = pixelRatioOf(world, world.canvas.ownerDocument?.defaultView)
    record.size[0] = Math.max(1, devicePixels(record.canvas.clientWidth, r))
    record.size[1] = Math.max(1, devicePixels(record.canvas.clientHeight, r))
    record.handle?.resize(...record.size)
    return undefined
  }
  const { canvas } = world
  record.measuredOver[0] = canvas.width
  record.measuredOver[1] = canvas.height
  const sx = canvas.width / Math.max(1, canvas.clientWidth),
    sy = canvas.height / Math.max(1, canvas.clientHeight),
    { x, y, width, height } = record.viewport
  const rect = { x: x * sx, y: y * sy, width: width * sx, height: height * sy }
  record.size[0] = Math.max(1, Math.round(rect.width))
  record.size[1] = Math.max(1, Math.round(rect.height))
  record.handle?.resize(record.size[0], record.size[1], rect)
  return rect
}

/** The engine's view of `record` in `session`, once made: drawn from the next frame. */
async function open(state: ViewsState, record: ViewRecord, session: MeasuredWorld) {
  const rect = measure(state, record)
  const { renderScale, temporalAntialiasing } = record.options
  const made = await session.engine.addView({
    ...(rect ? { rect } : { canvas: record.canvas }),
    renderScale,
    temporalAntialiasing,
  })
  // Closed, or the view removed, while it was made: it leaves.
  if (state.explorer !== session || record.disposed) return void made.release()
  record.handle = made
  record.host = session.camera.clone()
  measure(state, record)
  state.world.invalidate()
}

/** `open`: refused by a session closed meanwhile, the view waits for the next one, which makes
 *  it again (`attach`); refused by the open one, it is said on the console, and drawn by none. */
const opening = (state: ViewsState, record: ViewRecord, session: MeasuredWorld) =>
  open(state, record, session).catch((error: unknown) => {
    if (state.explorer === session && !record.disposed)
      console.error('[trillion3d] A view could not be made', error)
  })

/** Whether `record` is drawn in the frame that began at `now`, its cap kept on the display's
 *  grid (`capSkips`, `refreshMs` the display's refresh once measured). */
const due = (record: ViewRecord, now: number, refreshMs: number | null) =>
  !capSkips(record.options.maxFrameRate, refreshMs, now - record.drawnAt)

/** The record of a view added with `options`, over the canvas it names or the world's. */
function newViewRecord({ world, adopt }: ViewsState, options: ViewOptions): ViewRecord {
  const target = options.canvas ? resolveWorldTarget(options.canvas) : undefined
  return {
    options: {
      renderScale: options.renderScale ?? 'auto',
      temporalAntialiasing: temporalAntialiasingLevel(options.temporalAntialiasing),
      maxFrameRate: options.maxFrameRate ?? Infinity,
    },
    canvas: target?.canvas ?? world.canvas,
    release: target?.release ?? (() => {}),
    viewport: options.viewport && { ...options.viewport },
    camera: adopt(options.camera ?? new Camera('perspective')),
    handle: undefined,
    host: undefined,
    size: [1, 1],
    measuredOver: [0, 0],
    drawnAt: -Infinity,
    hooks: new Set(),
    info: undefined,
    observer: undefined,
    disposed: false,
    view: undefined,
  }
}

function addView(state: ViewsState, options: ViewOptions) {
  if (!options.canvas === !options.viewport)
    throw new EngineError(
      'INVALID_VIEW',
      'A view draws into a canvas or over a viewport, one of them',
    )
  const { world, records } = state
  const record = newViewRecord(state, options)
  if (options.canvas && typeof ResizeObserver !== 'undefined') {
    record.observer = new ResizeObserver(() => (measure(state, record), world.invalidate()))
    record.observer.observe(record.canvas)
  }
  records.push(record)
  if (state.explorer) void opening(state, record, state.explorer)
  return (record.view = worldView(state, record))
}

/** What the page holds of a view: its canvas, camera and rectangle. */
function viewPlacement(state: ViewsState, record: ViewRecord) {
  const { world, adopt } = state
  return {
    /** The canvas the view draws into: its own, or the world's for a view over a viewport. */
    canvas: record.canvas,
    /** The camera it looks through; set another to switch. */
    get camera() {
      return record.camera
    },
    set camera(next: Camera) {
      record.camera = adopt(next)
      world.invalidate()
    },
    /** The rectangle of the world's canvas it is drawn over, CSS pixels; undefined for a view
     *  on a canvas of its own. Set, it moves from the next frame. */
    get viewport(): ViewRect | undefined {
      return record.viewport && { ...record.viewport }
    },
    set viewport(rect: ViewRect | undefined) {
      if (!record.viewport || !rect) return
      record.viewport = { ...rect }
      measure(state, record)
      world.invalidate()
    },
  }
}

/** What the page holds of a view: its render scale, antialiasing, frame cap, hook and removal. */
function viewSettings({ world, records }: ViewsState, record: ViewRecord) {
  return {
    /** Its render scale, from the next frame; read, the scale of its last image. */
    get renderScale(): number {
      return record.info?.metrics.renderScale ?? 1
    },
    set renderScale(scale: RenderScale) {
      record.options.renderScale = scale
      record.handle?.setRenderScale(scale)
      world.invalidate()
    },
    /** Its own temporal antialiasing's level, from the next frame; `true` or none the default
     *  level, `false` off. Read, the level asked, as the world's. */
    get temporalAntialiasing(): TemporalAntialiasingLevel {
      return record.options.temporalAntialiasing
    },
    set temporalAntialiasing(option: TemporalAntialiasingOption | null | undefined) {
      const level = temporalAntialiasingLevel(option)
      record.options.temporalAntialiasing = level
      record.handle?.setTemporalAntialiasing(level)
      world.invalidate()
    },
    /** The most frames a second it is drawn, from the next frame. */
    get maxFrameRate() {
      return record.options.maxFrameRate
    },
    set maxFrameRate(rate: number) {
      record.options.maxFrameRate = rate
    },
    /** Runs a function after every frame that drew the view, with `{ delta, metrics }`;
     *  returns its remover. */
    onFrame(hook: (info: ViewFrameInfo) => void) {
      record.hooks.add(hook)
      return () => void record.hooks.delete(hook)
    },
    /** Takes the view out of the world: its GPU resources go, a canvas the world made for it
     *  too; the page's own canvas is kept. */
    dispose() {
      if (record.disposed) return
      record.disposed = true
      records.splice(records.indexOf(record), 1)
      record.observer?.disconnect()
      void record.handle?.release()
      record.handle = undefined
      record.release()
      world.invalidate()
    },
  }
}

/** What the page holds of a view. */
const worldView = (state: ViewsState, record: ViewRecord): WorldView =>
  joined(viewPlacement(state, record), viewSettings(state, record))

/** Whether `canvas`'s buffer is no longer the `size` it was measured at. */
const resized = (canvas: HTMLCanvasElement, size: readonly [number, number]) =>
  canvas.width !== size[0] || canvas.height !== size[1]

/** Draws every view due in the frame under way, after its main image (`createDrawFrame`). */
function drawDue(state: ViewsState, refreshMs: number | null) {
  const { records, drawn, drawnRecords } = state
  drawn.length = drawnRecords.length = 0
  const now = frameStart()
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (!record.handle || !record.host || !due(record, now, refreshMs)) continue
    // A view over a rectangle of the world's canvas follows that canvas's size, which no observer
    // of its own watches: measured again before it is drawn once that size moved.
    if (record.viewport && resized(state.world.canvas, record.measuredOver)) measure(state, record)
    copyWorldCamera(record.camera, record.host, record.size[0] / record.size[1])
    const metrics = record.handle.render(record.host, index)
    const info = (record.info ??= { delta: 0, metrics })
    info.delta = record.drawnAt === -Infinity ? 0 : (now - record.drawnAt) / SECOND_MS
    info.metrics = metrics
    record.drawnAt = now
    drawn.push(metrics)
    drawnRecords.push(record)
  }
}

/**
 * THE WORLD'S VIEWS (`world.addView`): one scene drawn by several cameras, each into a canvas of
 * its own or over a rectangle of the world's. A view shares everything that does not depend on a
 * camera — the scene and its placements, the pages and their pools, the materials, the shadow
 * pool and the pages it renders, the physics, the clips — and owns what does: its cut, its
 * visibility and occlusion, its lighting resolve, its temporal history and its effects
 * (`../../frame/backend/state/persistentView.ts`). Each frame of the world draws the main view, then
 * every view due, in the order they were added, in one loop and on one budget.
 */
export function createWorldViews(world: WorldOfViews) {
  const state: ViewsState = {
    world,
    records: [],
    adopt: cameraAdopter(world.invalidate),
    explorer: null,
    drawn: [],
    drawnRecords: [],
  }
  const { records, drawn, drawnRecords } = state
  return {
    addView: (options: ViewOptions) => addView(state, options),
    /** The page's views, in the order they were added. */
    get list() {
      return records.map((record) => record.view!)
    },
    /** `session` opened: every view is made in it, drawn once made; a session that closed takes
     *  its views with it. */
    attach(session: MeasuredWorld | null) {
      state.explorer = session
      for (const record of records) {
        record.handle = undefined
        if (session) void opening(state, record, session)
      }
    },
    draw: (refreshMs: number | null) => drawDue(state, refreshMs),
    /** The frame's metrics carry the views it drew, whose hooks then run, after the world's. */
    drawnIn(metrics: { views?: readonly ViewFrameMetrics[] }) {
      metrics.views = drawn
    },
    dispatch() {
      for (const record of drawnRecords)
        if (!record.disposed) for (const hook of record.hooks) hook(record.info!)
    },
    /** The views leave with the world. */
    dispose() {
      for (const record of [...records]) record.view!.dispose()
    },
  }
}

/** A view of the world (`world.addView`): its own camera, canvas or rectangle, render scale,
 *  temporal antialiasing and frame cap, over the world's one scene. */
export interface WorldView {
  readonly canvas: HTMLCanvasElement
  camera: Camera
  viewport: ViewRect | undefined
  get renderScale(): number
  set renderScale(scale: RenderScale)
  get temporalAntialiasing(): TemporalAntialiasingLevel
  set temporalAntialiasing(option: TemporalAntialiasingOption | null | undefined)
  maxFrameRate: number
  onFrame(hook: (info: ViewFrameInfo) => void): () => void
  dispose(): void
}
