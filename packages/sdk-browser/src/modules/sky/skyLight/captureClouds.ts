import { cloudsInView } from '../clouds/cloudModes.ts'
import { captureCloudKey, type CloudTraceKey } from '../clouds/traceExtraLayout.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import type { SkyLightPipelines } from './pipelines.ts'

/**
 * THE CLOUDS A CAPTURE TRACES THIS FRAME, and the program that traces them (`captureCloudKey`): the
 * air they stand on, the clouds' own inputs and the key. None where the capture holds no clouds or
 * no air to stand them on (the atmosphere's, or the stand-in of a scene with none), the clouds are
 * kept out of the capture (`inSkyCapture`), or the fog is not given.
 *
 * The sun's shadow in the opaque scene is read where the capture asks for it
 * (`skyLightShadowFromOpaque`) and the shadow maps hold the sun's channel (`sunShadowChannel`); the
 * sky light's harmonics are read where the scene has no air to give the distant sky light.
 */
export interface CapturedClouds {
  readonly air: NonNullable<SkyLightInputs['air']>
  readonly clouds: NonNullable<SkyLightInputs['clouds']>
  readonly key: CloudTraceKey
}

/** What each frame's `input` was asked once: the frame's readers (the wait for the program, the
 *  groups, the faces) share one key, and with it the program it names. */
const asked = new WeakMap<SkyLightInputs, CapturedClouds | undefined>()

/** The clouds `input` traces this frame, none where it traces none; worked out once for an `input`. */
export function capturedClouds(input: SkyLightInputs): CapturedClouds | undefined {
  if (asked.has(input)) return asked.get(input)
  const { air, clouds, fog } = input
  const traced =
    air && clouds && fog && cloudsInView(clouds.part.settings, true)
      ? {
          air,
          clouds,
          key: captureCloudKey(
            clouds.part.quality,
            input.part.quality.skyLightShadowFromOpaque &&
              clouds.air.sunShadowChannel !== undefined,
            !clouds.air.airPresent,
            clouds.part.material,
          ),
        }
      : undefined
  asked.set(input, traced)
  return traced
}

/** Whether the program of the clouds `input` traces is compiled, asked where it is not made yet: a
 *  capture waits for it, as it waits for its other pipelines. */
export function cloudsCompiled(made: Pick<SkyLightPipelines, 'cloudTrace'>, input: SkyLightInputs) {
  const traced = capturedClouds(input)
  return !traced || made.cloudTrace(traced.key).pipeline.ready
}
