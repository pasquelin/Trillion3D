// The world both scene-trace proofs open: the scene compiled once for the file and opened on Dawn
// with the engine's runtime kept, and the view it is held at.
import { measurementSdk, proofCanvas } from '../../kit/device/renderHarness.ts'
import { runtimeKeepingEngine } from '../../kit/device/pagesRuntime.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import { HLOD_OFFSET, hlodSceneManifest, traceSceneManifest } from './sceneTraceScene.ts'

/** The eye, over the ground, looking at the boxes; the view the frustum rays are cast through. */
export const POSE: CameraPose = {
  position: [0, 5, 16],
  target: [0, 1, 0],
  fov: 50,
  near: 0.1,
  far: 200,
}
/** The eye of the HLOD scene, level with the scene's (`HLOD_OFFSET`) and looking along it, 700 metres from it. */
export const HLOD_POSE: CameraPose = {
  position: [HLOD_OFFSET[0], 5, 16],
  target: [HLOD_OFFSET[0], 1, HLOD_OFFSET[2]],
  fov: 50,
  near: 0.1,
  far: 2000,
}
export const SIZE: [number, number] = [320, 240]

/** The scene, or the HLOD scene, compiled once for the file, and opened on Dawn with the runtime kept
 *  (`runtimeKeepingEngine`): no temporal accumulation, the finest cut. */
const manifests: { plain?: string; hlod?: string } = {}
export async function openTraceWorld(
  options: { surfaceCacheDirectLightingHardwareRayTracing?: boolean } = {},
  scene: 'plain' | 'hlod' = 'plain',
) {
  const { openMeasuredWorld } = await measurementSdk()
  const { factory, runtime } = runtimeKeepingEngine()
  const canvas = proofCanvas('scene-trace')
  const world = await openMeasuredWorld(canvas, {
    manifestUrl: (manifests[scene] ??=
      scene === 'hlod' ? hlodSceneManifest() : traceSceneManifest()),
    scope: 'full',
    interactive: false,
    width: SIZE[0],
    height: SIZE[1],
    pixelRatio: 1,
    pixelError: 0,
    maxResidentPages: 100000,
    temporalAntialiasing: false,
    engine: factory,
    ...options,
  })
  return { world, canvas, runtime }
}
