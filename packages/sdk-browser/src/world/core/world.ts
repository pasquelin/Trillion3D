import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { cameraAdopter } from './worldLink.ts'
import type { ToneMapping } from '../../../../sdk-core/src/world/constants/index.ts'
import { resolveWorldTarget, type WorldTarget } from './worldTarget.ts'
import { holdWorldDevice, worldRecovered } from './worldDevice.ts'
import { createWorldFrames, type BeforeFrameInfo, type FrameInfo } from './worldFrames.ts'
import { createWorldRuntime } from './worldRuntime.ts'
import { Scene, sceneFogOf, type LoadOptions } from './scene.ts'
import { worldModelLoader } from './worldLoader.ts'
import { worldSceneMethods } from './worldSceneMethods.ts'
import { awaitViewPages, registerWorld, type JobProgress } from './worldSession.ts'
import { sessionOptions, type WorldOptions } from './worldOptions.ts'
import { worldControlsHandle, worldDiagnostic } from './worldHandles.ts'
import { sessionPools, worldBudget, worldPools } from './worldBudget.ts'
import { noticeEffectBudget } from '../diagnostic/worldNotices.ts'
import { worldTelemetry } from './worldTelemetry.ts'
import { createWorldPhysics } from '../../physics/worldPhysics.ts'
import { noVehicle } from './worldControlTargets.ts'
import { worldSwitches } from './worldSwitches.ts'
import { worldMaterialMethods } from './worldMaterialMethods.ts'
import { worldMixerView } from './worldMixerView.ts'
/** Creates a world: the scene, camera, engine and loop of one view, on its own WebGPU device.
 * @param target - The canvas to draw into, an element to draw inside, or the ID of either.
 * @param options - How the world draws and listens; saying nothing is the normal case.
 * @example const world = createWorld('viewer', { controls: 'orbit' });
 * await world.scene.load('/cache/city/manifest.json'); */
export function createWorld(target: WorldTarget, options: WorldOptions = {}) {
  if (options.controls === 'vehicle') throw noVehicle()
  const parts = worldParts(target, options)
  const { canvas, frames, diagnostic, runtime, switches } = parts
  const world = joined(worldView(parts), worldSettings(parts), worldMethods(parts))
  frames.add(noticeEffectBudget(world.budget, canvas, world.effects, diagnostic.notices))
  registerWorld(world, { session: () => runtime.explorer, last: () => frames.last }, switches.held)
  return world
}

/** `a` given the members of `b` and `c`, each accessor kept as an accessor: a spread would read
 *  it once and keep the value. */
function joined<A extends object, B extends object, C extends object>(a: A, b: B, c: C) {
  for (const part of [b, c]) Object.defineProperties(a, Object.getOwnPropertyDescriptors(part))
  return a as A & B & C
}

/** What a world shows of itself and its page sets: its camera, curve and exposure, and whether
 *  it is gone. */
type WorldState = {
  camera: Camera
  toneMapping: ToneMapping
  exposure: number
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
    exposure: 1,
    animating: false,
    disposed: false,
  }
  const device = holdWorldDevice((lostAt) =>
    worldRecovered(runtime, frames, diagnostic.notices, pools.pageCache, lostAt),
  )
  const scene = new Scene(worldModelLoader(device.ready, options.signal, pools.pageCache))
  const invalidate = () => runtime.invalidate()
  const diagnostic = worldDiagnostic(() => runtime.explorer, options.debug)
  const switches = worldSwitches(options, () => runtime, frames)
  const runtime = worldRuntimeOf({
    ...{ canvas, options, device, scene, state, frames, switches, pools, diagnostic, invalidate },
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
    ...{ canvas, releaseCanvas, frames, pools, state, device, scene, invalidate, diagnostic },
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
  /** Moves what the frame steps ahead of the draw: controls, clips, physics. */
  step: () => void
}

/** The session runtime of a world (`worldRuntime.ts`), opened with its options of the moment. */
function worldRuntimeOf(parts: RuntimeNeeds) {
  const { canvas, options, device, scene, state, frames, switches, pools, diagnostic } = parts
  const runtime = createWorldRuntime({
    canvas,
    ready: () => device.pending,
    scene,
    camera: () => state.camera,
    options: () =>
      sessionOptions(options, {
        gpuDevice: device.gpuDevice, // the world's one device: a session never asks another
        ...switches.held,
        ...sessionPools(pools),
        clearColor: scene.background?.getHex(), // read at opening; a change is written in place
        currentClearColor: () => scene.background?.getHex(),
        beforeFrame: () => (parts.step(), runtime.beforeFrame()),
        onFrame: (metrics) => {
          frames.dispatch(metrics)
          // A clip still playing asks for the next; the last pauses.
          if (state.animating) parts.invalidate()
        },
      }),
    opened: (explorer) => diagnostic.apply(explorer),
    frame: frames.dispatch,
    drawn: () => frames.last !== null,
    display: () => ({
      exposure: state.exposure,
      toneMapping: state.toneMapping,
      fog: sceneFogOf(scene.fog),
    }),
    diagnostic,
  })
  return runtime
}

/** What a world shows of its view: its canvas, device, scene, controls, camera, curve, exposure. */
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
    /** Temporal antialiasing: sub-pixel jitter accumulated over frames; on by default. Written, it
     *  takes effect at the next frame, history dropped, no session reopened. Read, it is what the
     *  image carries: false while the program compiles after it was turned on. */
    get temporalAntialiasing() {
      return switches.temporalAntialiasing
    },
    set temporalAntialiasing(on: boolean) {
      switches.temporalAntialiasing = on
    },
    /** The fraction of the display per axis the image is drawn at (`WorldOptions.renderScale`),
     *  from the next frame. Read, the scale of the last image drawn. */
    get renderScale(): number {
      return switches.renderScale
    },
    set renderScale(scale: import('../../frame/renderScaleOption.ts').RenderScale) {
      switches.renderScale = scale
    },
    /** The effect chain: passes drawn over the image (`effect`). */ effects: switches.held.effects,
  }
}

/** The world's parts and methods: physics, budget, diagnostic, guides, materials, nodes, frames,
 *  pages, and its disposal. */
function worldMethods(parts: WorldParts) {
  const { canvas, frames, pools, state, scene, invalidate, diagnostic, switches } = parts
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
    ...worldSceneMethods(scene, () => state.camera, canvas, physics.session, runtime),
    /** Runs a function after every drawn frame, with its time and metrics; returns its remover. */
    onFrame: frames.add,
    /** Runs a function ahead of every drawn frame, with `{ delta, time }`; returns its remover.
     * A frame runs: the camera's controller (unless `controls.autoUpdate` is false or the host
     * leads, `render()`), the clips, the physics, these hooks in their order, the draw, then the
     * `onFrame` hooks. What a hook places — a body on the camera, a cockpit — is drawn in this
     * very frame, never one late. A hook calling `invalidate()` keeps frames coming. */
    beforeFrame: frames.before,
    /** Another name for `onFrame`. */ loop: frames.add,
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
      for (const part of [controls, physics, runtime]) part.dispose()
      pools.pageCache.clear()
      diagnostic.close()
      frames.clear()
      parts.device.dispose()
      parts.releaseCanvas()
    },
  }
}

/** What `createWorld` returns: one view. */ export type World = ReturnType<typeof createWorld>
export type { FrameInfo, BeforeFrameInfo, WorldTarget, LoadOptions, WorldOptions }
