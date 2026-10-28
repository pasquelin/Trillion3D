import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { ToneMapping } from '../../../../sdk-core/src/world/constants/index.ts'
import type { SceneExposure } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { holdWorldDevice } from './device.ts'
import type { createWorldFrames } from './frames/frames.ts'
import { createWorldRuntime } from './runtime.ts'
import type { Scene } from './scene.ts'
import type { WorldModules } from './worldModules.ts'
import { sessionOptions, type WorldOptions } from './options.ts'
import type { worldDiagnostic } from './handles.ts'
import { sessionPools, type worldPools } from './budget.ts'
import type { worldSwitches } from './switches.ts'
import type { createWorldViews } from './views.ts'

/** What a world shows of itself and its page sets: its camera, curve, exposure, sharpening and
 *  vignette, and whether it is gone. */
export type WorldState = {
  camera: Camera
  toneMapping: ToneMapping
  exposure: SceneExposure
  sharpness: number
  vignette: number
  /** A clip still plays: the frame drawn asks for the next. */
  animating: boolean
  disposed: boolean
}

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
  modules: WorldModules
  /** The loads the first session waits for: its models, not in the scene yet. */
  loading: () => Promise<unknown> | undefined
  /** Moves what the frame steps ahead of the draw: controls, clips, physics. */
  step: () => void
}

/** The session runtime of a world (`runtime.ts`), opened with its options of the moment. */
export function worldRuntimeOf(parts: RuntimeNeeds) {
  const { canvas, options, device, scene, state, frames, switches, pools, diagnostic } = parts
  const { views, modules } = parts
  const runtime = createWorldRuntime({
    canvas,
    // The device granted, and the models asked for meanwhile in the scene (`loader.ts`).
    ready: async () => {
      await device.pending
      // The first session opens once the quality is decided — the benchmark of an `auto` world runs here, never while frames are drawn — and the models are loaded, the two at once.
      await Promise.all([
        switches.decided(),
        (async () => {
          for (let base = parts.loading(); base; base = parts.loading()) await base
        })(),
      ])
    },
    scene,
    camera: () => state.camera,
    options: () =>
      sessionOptions(options, {
        gpuDevice: device.gpuDevice, // the world's one device: a session never asks another
        ...switches.held,
        ...switches.raster,
        ...switches.streaming,
        ...switches.worldStreaming,
        ...switches.cut,
        ...switches.animation,
        ...switches.shading,
        ...sessionPools(pools),
        // The session's own loop runs the world's frame: its prologue and epilogue, as `render`.
        beforeFrame: () => runtime.beforeFrame(parts.step),
        worldClock: frames.clock,
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
      vignette: state.vignette,
      fog: modules.sky.resolved?.fog,
      atmosphere: modules.sky.resolved?.atmosphere,
    }),
    modules,
    diagnostic,
  })
  return runtime
}
