import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import {
  DEFAULT_SHARPNESS,
  DEFAULT_TONE_MAPPING,
  DEFAULT_VIGNETTE,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { DEFAULT_EXPOSURE } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { cameraAdopter } from './link.ts'
import { resolveWorldTarget, type WorldTarget } from './target.ts'
import { holdWorldDevice } from './device.ts'
import { createWorldFrames } from './frames/frames.ts'
import { Scene } from './scene.ts'
import { worldModelLoader } from './loader.ts'
import type { WorldOptions } from './options.ts'
import { worldControlsHandle } from './controls/controlsHandle.ts'
import { worldDiagnostic } from './handles.ts'
import { worldPools } from './budget.ts'
import { createWorldPhysics } from '../../physics/worldPhysics.ts'
import { worldSwitches } from './switches.ts'
import { worldMixerView } from './mixerView.ts'
import { createWorldViews } from './views.ts'
import { worldRuntimeOf, type WorldState } from './worldRuntime.ts'
import { createWorldModules } from './worldModules.ts'

/** The state a world starts in: a perspective camera, the display defaults, nothing animating. */
const startingState = (): WorldState => ({
  camera: new Camera('perspective'),
  toneMapping: DEFAULT_TONE_MAPPING,
  exposure: DEFAULT_EXPOSURE,
  sharpness: DEFAULT_SHARPNESS,
  vignette: DEFAULT_VIGNETTE,
  animating: false,
  disposed: false,
})

/** The parts of one world: its canvas, frames, pools, device, scene, session runtime, physics and
 *  controls, built around one state. */
export function worldParts(target: WorldTarget, options: WorldOptions) {
  const { canvas, release: releaseCanvas } = resolveWorldTarget(target)
  const frames = createWorldFrames()
  const pools = worldPools()
  const state = startingState()
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
  const modules = createWorldModules({ canvas, changed: () => runtime.displayChanged() })
  const runtime = worldRuntimeOf({
    ...{ canvas, options, device, scene, state, frames, switches, pools, diagnostic, invalidate },
    views,
    modules,
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
    ...{ switches, modules, runtime, physics, adopt, controls, ahead, live },
  }
}
/** What `worldParts` builds. */
export type WorldParts = ReturnType<typeof worldParts>
