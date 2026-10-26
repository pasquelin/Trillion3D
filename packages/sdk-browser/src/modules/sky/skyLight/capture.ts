import type { skyLightSource } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { AirShape } from '../../../lighting/atmosphere/shape.ts'
import { cloudsCompiled } from './captureClouds.ts'
import { createCubemapCapture } from './captureCubemap.ts'
import { createFaceDrawer, skyCompiled } from './captureFaces.ts'
import { createFollower } from './captureFollow.ts'
import { createSceneCapture, type SceneCaptureHost } from './captureScene.ts'
import { createFilterStage } from './captureFilter.ts'
import { encodeRealTime } from './captureRealTime.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import { createSkyLightPipelines } from './pipelines.ts'
import { newCaptureState, type CaptureState } from './schedule.ts'
import type { SkyLightTargets } from './targets.ts'
import { readCaptured } from './readCaptured.ts'

export type { SkyLightInputs } from './captureInputs.ts'

/** What a frame of the capture is encoded with (`encodeFrame`). */
interface CaptureParts {
  readonly made: ReturnType<typeof createSkyLightPipelines>
  readonly stage: ReturnType<typeof createFilterStage>
  readonly faces: ReturnType<typeof createFaceDrawer>
  readonly cubemap: ReturnType<typeof createCubemapCapture>
}

/** This frame's work on `encoder`, the light's source now being `now`. The scene drawn into the cube
 *  once (`'capturedScene'`) is drawn between two frames (`captureScene`), not in this one; the
 *  real-time capture waits for the clouds' program and the shaded sky's. */
function encodeFrame(
  { made, stage, faces, cubemap }: CaptureParts,
  state: CaptureState,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  now: ReturnType<typeof skyLightSource>,
  input: SkyLightInputs,
) {
  stage.slot = 0
  if (now === 'specifiedCubemap') return cubemap.encode(encoder, t, input)
  if (now === 'realTime' && cloudsCompiled(made, input) && skyCompiled(made, input))
    encodeRealTime(stage, faces, state, encoder, t, input)
}

/**
 * THE SKY LIGHT'S CAPTURE, encoded a frame at a time: the sky and the clouds drawn into the faces
 * of a cube (`captureFaces.ts`), the cube's mips, the cube filtered by roughness, and the diffuse
 * light summed into harmonics (`captureFilter.ts`), on the steps and in the order `schedule.ts`
 * says; or, for a specified cubemap, the host's cube taken to the same (`captureCubemap.ts`).
 * A captured scene (`'capturedScene'`) is drawn between two frames: the owner asks `sceneDue` once a
 * frame and, when it is, awaits `captureScene` after the frame is submitted (`captureScene.ts`);
 * `recapture` asks one. Nothing is wired into a frame: the owner calls `encode` once a frame,
 * before the passes that read the light, and reads the ready cube and the harmonics through `read`.
 */
export function createSkyLightCapture(
  device: GPUDevice,
  failed: (error: unknown) => void,
  shape: AirShape,
) {
  const made = createSkyLightPipelines(device, failed, shape)
  const { pipelines } = made
  const faces = createFaceDrawer(device, made)
  const stage = createFilterStage(device, pipelines)
  const cubemap = createCubemapCapture(device, failed, stage)
  let state = newCaptureState()
  const followed = createFollower(device, made, restart)
  const scene = createSceneCapture(device, failed, stage, cubemap.pipelines, () => followed.targets)
  const ready = () => Object.values(pipelines).every((p) => p.ready)
  const parts = { made, stage, faces, cubemap }

  /** The capture starts again: the slices, the specified cubemap's capture and the scene's. */
  function restart() {
    state = newCaptureState()
    cubemap.reset()
    scene.forget()
  }

  return {
    /** Whether every pipeline is compiled: until then a frame encodes nothing. */
    get ready() {
      return ready()
    },
    /** This frame's work on `encoder`, once a frame. */
    encode(encoder: GPUCommandEncoder, input: SkyLightInputs) {
      const { t, now } = followed.follow(input)
      encodeFrame(parts, state, encoder, t, now, input)
    },
    /** Whether a scene capture is due now: the light captures a scene, it was asked one, none is
     *  drawing, and the programs are compiled. Looks at the light, once a frame. */
    sceneDue(input: SkyLightInputs) {
      followed.follow(input)
      return scene.due(input) && ready()
    },
    /** Draws the scene aside from the light's position and makes the cube (`captureScene.ts`);
     *  awaited after the frame is submitted. */
    captureScene: (host: SceneCaptureHost, input: SkyLightInputs) => scene.run(host, input),
    /** Asks a capture of the scene at the next look: the host's `recapture`. */
    recapture: () => scene.recapture(),
    /** What the lighting reads: the ready filtered cube with its mips, the harmonics' buffer and
     *  the rescale of a cubemap written to fit the half float that goes into the light's colour
     *  (`skyLightColor`'s `cubemapScale`, 1 for the rest); none before the first frame, and none
     *  while a specified cubemap or a scene is not captured yet. */
    read() {
      return readCaptured(followed.targets, followed.source, state, cubemap, scene)
    },
    dispose() {
      followed.destroy()
    },
  }
}

/** The capture (`createSkyLightCapture`). */
export type SkyLightCapture = ReturnType<typeof createSkyLightCapture>
