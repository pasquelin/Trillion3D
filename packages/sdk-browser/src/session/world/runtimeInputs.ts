import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { SceneFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import type { SceneToneMapping } from '../../../../sdk-core/src/scene/core/environment.ts'
import type { SceneExposure } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { openMeasuredWorld, MeasuredWorld } from '../explorer.ts'
import type { MeasuredWorldOptions } from '../options.ts'
import type { Scene } from './scene.ts'
import type { worldDiagnostic } from './handles.ts'

/** What a world hands its runtime (`runtime.ts`): its canvas, scene and camera, the session
 *  options of the moment, and the hooks that hear each session and frame. */
export type WorldRuntimeInputs = {
  canvas: HTMLCanvasElement
  scene: Scene
  camera: () => Camera
  /** The session options of the moment: pools, loop and hooks. */
  options: () => MeasuredWorldOptions
  /** Runs on every new session, before its first frame: diagnostic mode, pools, the switches
   *  changed since it was `given` its options. */
  opened: (explorer: MeasuredWorld, given: MeasuredWorldOptions) => void
  frame: (metrics: FrameMetrics) => void
  /** What the page set: exposure, curve, sharpening, vignette, fog and atmosphere; the lights add
   *  their irradiance. */
  display: () => {
    exposure: SceneExposure
    toneMapping: SceneToneMapping
    sharpness?: number
    vignette?: number
    fog?: SceneFog
    atmosphere?: ResolvedAtmosphere
  }
  /** Whether the world has drawn a frame yet. */
  drawn: () => boolean
  /** Settles once the world's device is granted, a lost one asked again. */
  ready: () => Promise<unknown>
  /** The world's notices; each opening, tried or not; a session or a scene that failed, kept. */
  diagnostic: Pick<ReturnType<typeof worldDiagnostic>, 'notices' | 'failed' | 'opening'>
  /** Opens a session; stands for the engine's own. */
  open?: typeof openMeasuredWorld
}
