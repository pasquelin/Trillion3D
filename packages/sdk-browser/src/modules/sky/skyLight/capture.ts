import {
  skyLightCloudWidth,
  skyLightSource,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { createCubemapCapture } from './captureCubemap.ts'
import { createFaceDrawer } from './captureFaces.ts'
import { createFilterStage } from './captureFilter.ts'
import { encodeRealTime } from './captureRealTime.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import { createSkyLightPipelines } from './pipelines.ts'
import { newCaptureState, type CaptureState } from './schedule.ts'
import { createSkyLightTargets, type SkyLightTargets } from './targets.ts'

export type { SkyLightInputs } from './captureInputs.ts'

/** What the lighting reads: the ready filtered cube with its mips, the harmonics' buffer and the
 *  rescale of a 32-bit float cubemap that goes into the light's colour (`skyLightColor`'s
 *  `cubemapScale`, 1 for the rest); none before the first frame, and none while a specified
 *  cubemap is not captured, or for a source the engine cannot capture. */
function readCaptured(
  targets: SkyLightTargets | undefined,
  source: ReturnType<typeof skyLightSource> | undefined,
  state: CaptureState,
  cubemap: ReturnType<typeof createCubemapCapture>,
) {
  if (!targets) return undefined
  if (source === 'specifiedCubemap')
    return cubemap.done
      ? {
          cube: targets.filteredCubes[0],
          mips: targets.mips,
          harmonics: targets.harmonics,
          colorScale: cubemap.scales.light,
        }
      : undefined
  if (source !== 'realTime') return undefined
  return {
    cube: targets.filteredCubes[state.ready],
    mips: targets.mips,
    harmonics: targets.harmonics,
    colorScale: 1,
  }
}

/**
 * THE SKY LIGHT'S CAPTURE, encoded a frame at a time: the sky and the clouds drawn into the faces
 * of a cube (`captureFaces.ts`), the cube's mips, the cube filtered by roughness, and the diffuse
 * light summed into harmonics (`captureFilter.ts`), on the steps and in the order `schedule.ts`
 * says; or, for a specified cubemap, the host's cube taken to the same (`captureCubemap.ts`).
 * Nothing is wired into a frame: the owner calls `encode` once a frame, before the passes that
 * read the light, and reads the ready cube and the harmonics through `read`.
 */
export function createSkyLightCapture(device: GPUDevice, failed: (error: unknown) => void) {
  const made = createSkyLightPipelines(device, failed)
  const { pipelines, cloudTrace } = made
  const faces = createFaceDrawer(device, made)
  const stage = createFilterStage(device, pipelines)
  const cubemap = createCubemapCapture(device, failed, stage)
  let targets: SkyLightTargets | undefined
  let state = newCaptureState()
  let source: ReturnType<typeof skyLightSource> | undefined

  /** The capture starts again: the slices, and the specified cubemap's capture. */
  function restart() {
    state = newCaptureState()
    cubemap.reset()
  }

  return {
    /** Whether every pipeline is compiled: until then a frame encodes nothing. */
    get ready() {
      return Object.values(pipelines).every((p) => p.ready) && cloudTrace.pipeline.ready
    },
    /** This frame's work on `encoder`, once a frame. */
    encode(encoder: GPUCommandEncoder, input: SkyLightInputs) {
      const cloudSide = skyLightCloudWidth(input.width, input.part)
      if (!targets || targets.width !== input.width || targets.cloudSide !== cloudSide) {
        targets?.destroy()
        targets = createSkyLightTargets(device, made, input.width, cloudSide)
        restart()
      }
      const t = targets
      stage.slot = 0
      const now = skyLightSource(input.part)
      if (now !== source) {
        source = now
        restart()
      }
      // The scene drawn into the cube once (`'capturedScene'`) is not drawn by this engine.
      if (now === 'specifiedCubemap') return cubemap.encode(encoder, t, input)
      if (now === 'realTime') encodeRealTime(stage, faces, state, encoder, t, input)
    },
    /** What the lighting reads: the ready filtered cube with its mips, the harmonics' buffer and
     *  the rescale of a 32-bit float cubemap that goes into the light's colour (`skyLightColor`'s
     *  `cubemapScale`, 1 for the rest); none before the first frame, and none while a specified
     *  cubemap is not captured, or for a source the engine cannot capture. */
    read() {
      return readCaptured(targets, source, state, cubemap)
    },
    dispose() {
      cubemap.dispose()
      targets?.destroy()
      targets = undefined
    },
  }
}

/** The capture (`createSkyLightCapture`). */
export type SkyLightCapture = ReturnType<typeof createSkyLightCapture>
