import {
  skyLightCloudWidth,
  skyLightSource,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import type { createSkyLightPipelines } from './pipelines.ts'
import { createSkyLightTargets, type SkyLightTargets } from './targets.ts'

/**
 * THE TARGETS AND THE SOURCE THE CAPTURE FOLLOWS: the cube's targets, made again when its side or
 * its clouds' side changes (the old ones retired after the frame's submit, `retire`), and the source the light now has (`skyLightSource`); the capture starts
 * again (`restart`) when either changed.
 */
export function createFollower(
  device: GPUDevice,
  made: ReturnType<typeof createSkyLightPipelines>,
  restart: () => void,
) {
  let targets: SkyLightTargets | undefined
  let source: ReturnType<typeof skyLightSource> | undefined
  return {
    /** The targets of a cube of `input`'s side and the light's source now. */
    follow(input: SkyLightInputs) {
      const cloudSide = skyLightCloudWidth(input.width, input.part)
      if (!targets || targets.width !== input.width || targets.cloudSide !== cloudSide) {
        if (targets) retire(device, targets)
        targets = createSkyLightTargets(device, made, input.width, cloudSide)
        restart()
      }
      const now = skyLightSource(input.part)
      if (now !== source) {
        source = now
        restart()
      }
      return { t: targets, now }
    },
    get targets() {
      return targets
    },
    get source() {
      return source
    },
    destroy() {
      if (targets) retire(device, targets)
      targets = undefined
    },
  }
}
