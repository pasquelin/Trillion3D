import type { CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import type { CloudShadowSet } from '../../lighting/atmosphere/cloudShadowRead.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { skyLightReadOf } from './skyLightState.ts'

/** What the capture of the sky light is told of the clouds, refilled each frame: the time, the blue
 *  noise, the air, the channel of the sun in the shadow maps and the sky light's read set; the part
 *  and the material are the sky's. The clouds' own shadow maps are the image's, read where the
 *  capture's inputs are made, once the maps are built (`inputsOf`, `./encodeSkyLight.ts`). */
export type CaptureClouds = {
  part: CloudPart
  material: readonly GPUBindGroupEntry[]
  blueNoise: GPUTextureView
  time: number
  air: {
    airPresent: boolean
    lightScales: [ArrayLike<number>, ArrayLike<number>]
    sunShadowChannel?: number
  }
  skyLight: SkyLightReadSet
  /** The maps built this image, or the stand-in that shades nothing where none is. */
  readonly cloudShadow: CloudShadowSet
}

export const WHITE = [1, 1, 1]

/** The blue noise the capture's clouds jitter by: the shadow maps', or their stand-in. */
export const noiseOf = (rt: WebgpuPagesRuntime) =>
  vsmOrStandIns(vsmConsumerResources(rt), rt.gpu.deferred!.placeholders).noise

/** The capture's clouds over the material's `entries`: the inputs an image changes are refilled each
 *  image (`refillCapture`), and the shadow maps are read where the capture's inputs are made, once
 *  they are built (the capture reads the maps of its own frame). */
export function captureCloudsOf(
  rt: WebgpuPagesRuntime,
  clouds: CloudPart,
  entries: readonly GPUBindGroupEntry[],
): CaptureClouds {
  return {
    part: clouds,
    material: entries,
    blueNoise: noiseOf(rt),
    time: 0,
    air: { airPresent: false, lightScales: [WHITE, WHITE] },
    skyLight: skyLightReadOf(rt),
    get cloudShadow() {
      return cloudShadowOf(rt) ?? cloudShadowStandIn(rt.gpu.device!)
    },
  }
}
