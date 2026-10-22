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

/** The clouds `input` traces this frame, none where it traces none. */
export function capturedClouds(input: SkyLightInputs): CapturedClouds | undefined {
  const { air, clouds, fog } = input
  if (!air || !clouds || !fog || !cloudsInView(clouds.part.settings, true)) return undefined
  const shadowed =
    input.part.quality.skyLightShadowFromOpaque &&
    air.maps !== undefined &&
    clouds.air.sunShadowChannel !== undefined
  return {
    air,
    clouds,
    key: captureCloudKey(clouds.part.quality, shadowed, !clouds.air.airPresent),
  }
}

/** Whether the program of the clouds `input` traces is compiled, asked where it is not made yet: a
 *  capture waits for it, as it waits for its other pipelines. */
export function cloudsCompiled(made: Pick<SkyLightPipelines, 'cloudTrace'>, input: SkyLightInputs) {
  const traced = capturedClouds(input)
  return !traced || made.cloudTrace(traced.key).pipeline.ready
}
