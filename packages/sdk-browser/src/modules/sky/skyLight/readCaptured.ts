import type { skyLightSource } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { createCubemapCapture } from './captureCubemap.ts'
import { createSceneCapture } from './captureScene.ts'
import type { CaptureState } from './schedule.ts'
import type { SkyLightTargets } from './targets.ts'

/** What the lighting reads: the filtered cubes as an array, and a view of each as a cube (`cubes`,
 *  the one the fog reads the layer of), with their mips, the layer of the ready one, the harmonics'
 *  buffer and the rescale of a cubemap that goes into the light's colour (`skyLightColor`'s
 *  `cubemapScale`: the one a cube written to fit the half float was given with,
 *  `SkyLightInputs.cubemapScale`; 1 for the rest); none before the first frame, and none while a
 *  specified cubemap or a scene is not captured yet, nor while the real-time capture has not once
 *  been complete: a cube made and never drawn into holds no sky. */
export function readCaptured(
  targets: SkyLightTargets | undefined,
  source: ReturnType<typeof skyLightSource> | undefined,
  state: CaptureState,
  cubemap: ReturnType<typeof createCubemapCapture>,
  scene: ReturnType<typeof createSceneCapture>,
) {
  if (!targets) return undefined
  if (source === 'specifiedCubemap')
    return cubemap.done
      ? {
          cube: targets.filteredArray,
          cubes: targets.filteredCubes,
          mips: targets.mips,
          harmonics: targets.harmonics,
          layer: cubemap.layer,
          blend: cubemap.blend,
          colorScale: cubemap.scale,
        }
      : undefined
  if (source === 'capturedScene')
    return scene.done
      ? {
          cube: targets.filteredArray,
          cubes: targets.filteredCubes,
          layer: 0,
          mips: targets.mips,
          harmonics: targets.harmonics,
          colorScale: 1,
          blend: 0,
        }
      : undefined
  return state.complete
    ? {
        cube: targets.filteredArray,
        cubes: targets.filteredCubes,
        layer: state.ready,
        mips: targets.mips,
        harmonics: targets.harmonics,
        colorScale: 1,
        blend: 0,
      }
    : undefined
}
