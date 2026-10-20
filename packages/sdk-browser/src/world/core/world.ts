import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { joined } from '../../../../sdk-core/src/runtime/joined.ts'
import {
  DEFAULT_EXPOSURE,
  DEFAULT_SHARPNESS,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { cameraAdopter } from './worldLink.ts'
import type { ToneMapping } from '../../../../sdk-core/src/world/constants/index.ts'
import { resolveWorldTarget, type WorldTarget } from './worldTarget.ts'
import { holdWorldDevice } from './worldDevice.ts'
import { createWorldFrames } from './worldFrames.ts'
import { createWorldRuntime } from './worldRuntime.ts'
import { Scene } from './scene.ts'
import { sceneFogOf } from './sceneFog.ts'
import { worldModelLoader } from './worldLoader.ts'
import { worldSceneMethods } from './worldSceneMethods.ts'
import { awaitViewPages, registerWorld } from './worldSession.ts'
import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs/jobs.ts'
import { sessionOptions, type WorldOptions } from './worldOptions.ts'
import { worldControlsHandle } from './worldControlsHandle.ts'
import { worldDiagnostic } from './worldHandles.ts'
import { sessionPools, worldBudget, worldPools } from './worldBudget.ts'
import { noticeEffectBudget } from '../diagnostic/worldNotices.ts'
import { worldTelemetry } from './worldTelemetry.ts'
import { createWorldPhysics } from '../../physics/worldPhysics.ts'
import { noVehicle } from './worldControlTargets.ts'
import { worldSwitches } from './worldSwitches.ts'
import { worldMaterialMethods } from './worldMaterialMethods.ts'
import { worldMixerView } from './worldMixerView.ts'
import { createWorldViews, type ViewOptions } from './worldViews.ts'
/** Creates a world: the scene, camera, engine and loop of one view, on its own WebGPU device.
 * @param target - The canvas to draw into, an element to draw inside, or the ID of either.
 * @param options - How the world draws and listens; saying nothing is the normal case.
 * @example const world = createWorld('viewer', { controls: 'orbit' });
 * await world.scene.load('/cache/city/manifest.json'); */
export function createWorld(target: WorldTarget, options: WorldOptions = {}) {
  if (options.controls === 'vehicle') throw noVehicle()
  const parts = worldParts(target, options)
  const { canvas, frames, diagnostic, runtime, switches } = parts
  const world = joined(
    worldView(parts),
    worldSettings(parts),
    worldMethods(parts),
    worldViewMethods(parts),
  )
  frames.add(noticeEffectBudget(world.budget, canvas, world.effects, diagnostic.notices))
  registerWorld(world, { session: () => runtime.explorer, last: () => frames.last }, switches.held)
  return world
}

/** What a world shows of itself and its page sets: its camera, curve, exposure and sharpening,
 *  and whether it is gone. */
type WorldState = {
  camera: Camera
  toneMapping: ToneMapping
  exposure: number
  sharpness: number
  /** A clip still plays: the frame drawn asks for the next. */
  animating: boolean
  disposed: boolean
}

/** The parts of one world: its canvas, frames, pools, device, scene, session runtime, physics and
 *  controls, built around one state. */
function worldParts(target: WorldTarget, options: WorldOptions) {
  const { canvas, release: releaseCanvas } = resolveWorldTarget(target)
  const frames = createWorldFrames()
  const pools = worldPools()
  const state: WorldState = {
    camera: new Camera('perspective'),
    toneMapping: 'aces',
    exposure: DEFAULT_EXPOSURE,
    sharpness: DEFAULT_SHARPNESS,
    animating: false,
    disposed: false,
  }
  const device = holdWorldDevice((lostAt) => runtime.renew('device-lost', lostAt))
  const loader = worldModelLoader(
    device.ready,
    options.signal,
    pools.pageCache,
    () => runtime.holdsSession,
    // A model's manifest naming its scene's temporal anti-aliasing level: the `scene` setting, the
    // first such model deciding.
    (model) => {
      const level = model.metadata.temporalAntialiasing
      if (level !== undefined) switches.sceneTemporalAntialiasing(level)
    },
  )
  const scene = new Scene(loader)
  const invalidate = () => runtime.invalidate()
  const views = createWorldViews({ canvas, pixelRatio: options.pixelRatio, invalidate })
  const diagnostic = worldDiagnostic(() => runtime.explorer, options.debug, invalidate)
  const switches = worldSwitches(options, () => runtime, frames)
  const runtime = worldRuntimeOf({
    ...{ canvas, options, device, scene, state, frames, switches, pools, diagnostic, invalidate },
    views,
    loading: loader.loading,
    step: () => ahead(controls),
  })
  const physics = createWorldPhysics(runtime, scene, () => state.camera, options.physics)
  const adopt = cameraAdopter(invalidate) // a camera outside the scene redraws when it moves
  adopt(state.camera)
  worldMixerView(scene, canvas, () => state.camera)
  const kind = options.controls ?? 'none'
  const camera = () => state.camera
  const controls = worldControlsHandle(kind, camera, canvas, invalidate, physics.character)
  const ahead = (by: typeof controls | null) => (state.animating = frames.step(by, scene, physics))
  const live = () => {
    if (state.disposed) throw new Error('World disposed')
    return runtime.explorer
  }
  return {
    ...{
      canvas,
      releaseCanvas,
      frames,
      pools,
      state,
      device,
      scene,
      invalidate,
      diagnostic,
      views,
    },
    ...{ switches, runtime, physics, adopt, controls, ahead, live },
  }
}
type WorldParts = ReturnType<typeof worldParts>

/** What a world's session runtime is opened with (`worldRuntimeOf`). */
type RuntimeNeeds = {
  canvas: HTMLCanvasElement
  options: WorldOptions
  device: ReturnType<typeof holdWorldDevice>
  scene: Scene
  state: WorldState
  frames: ReturnType<typeof createWorldFrames>
  switches: ReturnType<typeof worldSwitches>
  pools: ReturnType<typeof worldPools>
  diagnostic: ReturnType<typeof worldDiagnostic>
  invalidate: () => void
  views: ReturnType<typeof createWorldViews>
  /** The loads the first session waits for: its models, not in the scene yet. */
  loading: () => Promise<unknown> | undefined
  /** Moves what the frame steps ahead of the draw: controls, clips, physics. */
  step: () => void
}

/** The session runtime of a world (`worldRuntime.ts`), opened with its options of the moment. */
function worldRuntimeOf(parts: RuntimeNeeds) {
  const { canvas, options, device, scene, state, frames, switches, pools, diagnostic, views } =
    parts
  const runtime = createWorldRuntime({
    canvas,
    // The device granted, and the models asked for meanwhile in the scene (`worldLoader.ts`).
    ready: async () => {
      await device.pending
      for (let base = parts.loading(); base; base = parts.loading()) await base
    },
    scene,
    camera: () => state.camera,
    options: () =>
      sessionOptions(options, {
        gpuDevice: device.gpuDevice, // the world's one device: a session never asks another
        ...switches.held,
        ...sessionPools(pools),
        // The session's own loop runs the world's frame: its prologue and epilogue, as `render`.
        beforeFrame: () => runtime.beforeFrame(parts.step),
        drawViews: views.draw,
        onFrame: (metrics) => runtime.afterDraw(metrics),
      }),
    opened: (explorer, given) => {
      switches.apply(explorer, given)
      diagnostic.apply(explorer)
      views.attach(explorer)
    },
    frame: (metrics) => {
      // The frame's metrics carry the views it drew; their hooks run after the world's.
      views.drawnIn(metrics)
      frames.dispatch(metrics)
      views.dispatch()
      // A clip still playing asks for the next; the last pauses.
      if (state.animating) parts.invalidate()
    },
    drawn: () => frames.last !== null,
    display: () => ({
      exposure: state.exposure,
      toneMapping: state.toneMapping,
      sharpness: state.sharpness,
      fog: sceneFogOf(scene.fog),
    }),
    diagnostic,
  })
  return runtime
}

/** What a world shows of its view: its canvas, device, scene, controls, camera, curve, exposure,
 *  sharpening. */
function worldView(parts: WorldParts) {
  const { canvas, device, scene, controls, state, adopt, invalidate, runtime } = parts
  return {
    /** The canvas the world draws into. */ canvas,
    /** A promise that settles once the world holds its WebGPU device. */ ready: device.ready,
    /** The scene: everything added to it is drawn. */ scene,
    /** The mouse and keyboard controller that moves the camera. */ controls,
    /** The camera the image is seen through; set another to switch. */ get camera() {
      return state.camera
    },
    set camera(next: Camera) {
      state.camera = adopt(next)
      controls.follow()
      invalidate()
    },
    /** The curve that brings scene radiance into the display range; ACES by default. */
    get toneMapping() {
      return state.toneMapping
    },
    set toneMapping(curve: ToneMapping) {
      state.toneMapping = curve
      runtime.displayChanged()
    },
    /** Scene exposure, the multiplier the lighting applies before presentation. */
    get exposure() {
      return state.exposure
    },
    set exposure(value: number) {
      state.exposure = value
      runtime.displayChanged()
    },
    /** The tonemapper's sharpening, before the curve, so it sharpens linear light: 0 none,
     *  up to 1 (`SceneEnvironment.sharpness`). */
    get sharpness() {
      return state.sharpness
    },
    set sharpness(value: number) {
      state.sharpness = value
      runtime.displayChanged()
    },
  }
}

/** The world's drawing settings: screen error, quality, bounce, antialiasing, scale, effects. */
function worldSettings({ switches, live }: WorldParts) {
  return {
    /** The DAG cut's screen error, in pixels; the page's value holds over a quality preset. */
    get pixelError() {
      return switches.pixelError
    },
    set pixelError(value: number) {
      live()
      switches.pixelError = value
    },
    /** The quality: a preset, each group's level over it, and the resolution the image is drawn at. */
    quality: switches.quality,
    /** Light bounced off the surfaces, traced against the resident proxy; off by default. Applied
     *  in place on a path that carries it, taken by the next opening on one that does not. */
    get bounce() {
      return switches.bounce
    },
    set bounce(on: boolean) {
      switches.bounce = on
    },
    /** Temporal antialiasing: sub-pixel jitter accumulated over frames, at a quality level —
     *  `'off'`, `'low'`, `'medium'`, `'high'`, `'max'` (the default) —, `true` the default level
     *  and `false` off. Written, it takes effect at the next frame, no session reopened, over the
     *  quality preset and the scene's level; `undefined` gives it back to them. Read, the level
     *  resolved; whether the image carries it — not while its program compiles, nor on a device
     *  that refuses it — is the `'temporal antialiasing'` capability. */
    get temporalAntialiasing(): import('../../../../sdk-core/src/contracts/compilerAbi.ts').TemporalAntialiasingLevel {
      return switches.temporalAntialiasing
    },
    set temporalAntialiasing(
      option:
        | import('../../../../sdk-core/src/contracts/materialOptions.ts').TemporalAntialiasingOption
        | null
        | undefined,
    ) {
      switches.temporalAntialiasing = option
    },
    /** The fraction of the display per axis the image is drawn at (`WorldOptions.renderScale`),
     *  from the next frame. Read, the scale of the last image drawn. */
    get renderScale(): number {
      return switches.renderScale
    },
    set renderScale(scale: import('../../frame/renderScaleOption.ts').RenderScale) {
      switches.renderScale = scale
    },
    /** The most frames a second the world draws, even while its scene moves
     *  (`WorldOptions.maxFrameRate`), from the next frame; Infinity, the display's rate. */
    get maxFrameRate(): number {
      return switches.maxFrameRate
    },
    set maxFrameRate(rate: number) {
      switches.maxFrameRate = rate
    },
    /** The effect chain: passes drawn over the image (`effect`). */ effects: switches.held.effects,
  }
}

/** The world's views beside its main one: one scene, several cameras (`worldViews.ts`). */
function worldViewMethods({ views, live }: WorldParts) {
  return {
    /** Adds a view of the world's scene: its own camera, drawn into a canvas of its own or over a
     *  rectangle of the world's, each frame after the main image, on the world's one budget.
     *  Everything a camera does not change is the world's and shared: pages, shadows, materials,
     *  physics, clips. @param options - Where it draws, and how (`ViewOptions`).
     *  @example const side = world.addView({ canvas: 'side', camera: camera.perspective() }); */
    addView(options: ViewOptions) {
      live()
      return views.addView(options)
    },
    /** The views added, in their order; the main one is the world itself. */
    get views() {
      return views.list
    },
  }
}

/** The world's parts and methods: physics, budget, diagnostic, guides, materials, nodes, frames,
 *  pages, and its disposal. */
function worldMethods(parts: WorldParts) {
  const { canvas, frames, pools, state, invalidate, diagnostic, switches } = parts
  const { runtime, physics, controls, ahead, live } = parts
  return {
    /** Bodies, gravity and time of the physics (Jolt, in a worker). */ physics: physics.handle,
    /** The world's memory pools, read and set in bytes, and the physics envelopes. */
    budget: worldBudget(pools, runtime, frames, physics.budget),
    diagnostic: diagnostic.handle,
    /** Lines, points and helpers drawn over the image (`Guides`). */ guides: switches.guides,
    ...worldMaterialMethods(live, invalidate),
    /** The object a canvas point or a world ray meets, and a node reached by its name
     *  (`worldSceneMethods`): the world's methods over the nodes of its scene. */
    ...worldSceneMethods(() => state.camera, canvas, physics.session, runtime),
    /** Runs a function after every drawn frame, with its time and metrics; returns its remover. */
    onFrame: frames.add,
    /** Runs a function ahead of every drawn frame, with `{ delta, time }`; returns its remover.
     * A frame runs: the camera's controller (unless `controls.autoUpdate` is false or the host
     * leads, `render()`), the clips, the physics, these hooks in their order, the draw, then the
     * `onFrame` hooks. What a hook places — a body on the camera, a cockpit — is drawn in this
     * very frame, never one late. A hook calling `invalidate()` keeps frames coming. */
    beforeFrame: frames.before,
    /** Asks the world's own loop for a new frame after a change it could not see; a world its
     *  page leads draws at its next `render()`. */
    invalidate,
    /** Draws one frame, whoever leads the loop: clips and physics step with it. One the world
     *  cannot draw yet — its session opening, a part of the engine on its way — is drawn once it
     *  can, once however many were asked meanwhile. */
    render() {
      live()
      runtime.render(() => ahead(null))
    },
    /** Tells the world the canvas changed size; unset, it reads the canvas's own size.
     *  @param width - New width, CSS pixels. @param height - New height, CSS pixels. */
    resize(width = canvas.clientWidth, height = canvas.clientHeight) {
      live()?.resize(Math.floor(width), Math.floor(height))
      invalidate()
    },
    ...worldTelemetry(live),
    /** Resolves once the pages the current view reads are resident (`awaitViewPages`).
     *  @param options - `onProgress` hears `pages`, `completed` of `total`, as they land. */
    awaitPages: (options?: { onProgress?: (event: JobProgress) => void }) =>
      awaitViewPages(runtime, live, options?.onProgress),
    /** Stops the world and gives back all it took: GPU memory, loop, controls. */ dispose() {
      if (state.disposed) return
      state.disposed = true
      for (const part of [parts.views, controls, physics, runtime]) part.dispose()
      pools.pageCache.clear()
      diagnostic.close()
      frames.clear()
      parts.device.dispose()
      parts.releaseCanvas()
    },
  }
}

/** What `createWorld` returns: one view. */ export type World = ReturnType<typeof createWorld>
