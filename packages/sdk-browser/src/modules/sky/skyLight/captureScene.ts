import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { cross } from '../../../../../math/src/vector/vectorTuple.ts'
import { Camera } from '../../../../../sdk-core/src/world/camera/camera.ts'
import type { SkyLightPart } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { ViewCamera } from '../../../camera/world.ts'
import type { HdrViewsJob } from '../../../frame/io/hdrCapture.ts'
import type { ViewOverrides } from '../../../frame/backend/state/viewOverrides.ts'
import { copyBlockGroup, copyFacePass, createCopyWords } from './captureCopy.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import { finishCapture, type FilterStage } from './captureFilter.ts'
import type { CubemapPipelines } from './cubemapPipelines.ts'
import {
  forgetScene,
  lookAtScene,
  newSceneCaptureState,
  recaptureScene,
} from './captureSceneSchedule.ts'
import { CUBE_FACES, FACES, cubeToScene } from './layout.ts'
import type { SkyLightTargets } from './targets.ts'

/**
 * THE CAPTURE OF A SCENE INTO THE SKY LIGHT'S CUBE (`'capturedScene'`): the scene drawn aside
 * from the light's position through six cameras, the faces of a cube, the lit image of each taken
 * into the face of the captured cube, then the same mips, harmonics and filter as a specified cubemap
 * (`captureFilter.ts`). It runs between two frames, never inside one: the frame's driver looks at
 * the light (`due`), then awaits `run` once the frame is submitted. The cube is read once it is
 * made (`done`) and kept, shown, while the next capture is drawn; a recapture is asked by a change
 * `captureSceneSchedule.ts` lists or by `recapture`.
 */

/** What draws the scene aside: the engine (`Engine.captureHdrViews`). */
export interface SceneCaptureHost {
  captureHdrViews(job: HdrViewsJob): Promise<void>
}

/** The views of the capture's faces: no sky light, no direct, reflected or probe lighting that is
 *  not the scene's own — the lights, as lit (the emissive-only capture has none) —, no traced
 *  reflection, every surface rough and, for an emissive-only capture, black in its diffuse and
 *  its specular colour, no particle, shaft, light function nor effect, and a reflection capture,
 *  which the scene's fog shows in by its own switch (`ViewOverrides`). The detail asked is the
 *  quality's scale, 1 when it is not above zero. */
function skyLightCaptureOverrides(part: SkyLightPart): ViewOverrides {
  const { light, quality } = part
  const emissiveOnly = light.captureEmissiveOnly
  const scale = quality.skyLightCaptureLodDistanceScale
  return {
    skyLighting: false,
    lighting: !emissiveOnly,
    reflections: false,
    roughness: { min: 1, range: 0 },
    diffuse: emissiveOnly ? [0, 0, 0, 0] : undefined,
    specular: emissiveOnly ? [0, 0, 0, 0] : undefined,
    particles: false,
    lightShafts: false,
    lightFunctions: false,
    post: false,
    staticSceneOnly: light.mobility === 'static',
    lodScale: scale > 0 ? scale : 1,
    reflectionCapture: true,
  }
}

/**
 * The camera of face `face` standing at `eye` (scene metres): square, a field of 90 degrees, its
 * nearest distance `near`, no farthest (the projection is infinite). It looks along the face and its up is the face's, in the scene's axes
 * (`cubeToScene`); its right is the one a camera has, the face's reversed — a cube's faces are laid
 * as seen from outside, a camera sees them from inside —, which the copy turns back.
 */
export function faceViewCamera(face: number, eye: readonly number[], near: number): ViewCamera {
  const forward = cubeToScene(FACES[face].forward),
    up = cubeToScene(FACES[face].up),
    right = cross(forward, up)
  const camera = new Camera('perspective', { fov: 90, aspect: 1, near, far: Infinity })
  camera.matrixAutoUpdate = false
  // The camera looks down its own -z.
  camera.matrix.elements.set([...right, 0, ...up, 0, ...forward.map((c) => -c), 0, ...eye, 1])
  return camera
}

/** The copy of a face: the block the pass reads, then the pass. */
interface CopyHolds {
  readonly device: GPUDevice
  readonly pipelines: () => CubemapPipelines
  readonly words: ReturnType<typeof createCopyWords>
  sampler?: GPUSampler
  block?: { for: SkyLightTargets; group: GPUBindGroup }
}

/** Face `face` of the captured cube written from the lit image `lit`, drawn at `drawn` pixels of
 *  a target of `allocated` (`copySceneFaceMain`). */
function copyFace(
  h: CopyHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  part: SkyLightPart,
  lit: GPUTextureView,
  drawn: readonly number[],
  allocated: readonly number[],
  face: number,
) {
  const made = h.pipelines()
  h.sampler ??= postSamplers(h.device).clamped
  if (h.block?.for !== t)
    h.block = { for: t, group: copyBlockGroup(h.device, made.layouts.block, t) }
  copyFacePass(h.device, h.words, encoder, t, part.light, face, {
    pipeline: made.pipelines.copyScene.get(),
    source: h.device.createBindGroup({
      layout: made.layouts.scene,
      entries: [
        { binding: 2, resource: lit },
        { binding: 3, resource: h.sampler },
      ],
    }),
    block: h.block.group,
    turn: [0, 0],
    scale: [drawn[0] / allocated[0], drawn[1] / allocated[1], 1, 1],
  })
}

/** A capture the engine could not start yet: it is asked again at the next look. */
const retryable = (error: unknown) =>
  error instanceof Error && /^(SURFACE_CAPTURE_BUSY|CAPTURE_NOT_READY)/.test(error.message)

/** What a scene capture holds between its calls. */
interface SceneHolds extends CopyHolds {
  readonly failed: (error: unknown) => void
  readonly stage: FilterStage
  readonly targets: () => SkyLightTargets | undefined
  readonly state: ReturnType<typeof newSceneCaptureState>
}

/** The mips, the harmonics summed from them and the filter of the captured cube, in one submit. */
function finish(h: SceneHolds, t: SkyLightTargets) {
  const encoder = h.device.createCommandEncoder({ label: 'Trillion3D sky light scene' })
  h.stage.slot = 0
  finishCapture(h.stage, encoder, t, 0)
  h.device.queue.submit([encoder.finish()])
}

/** The six faces drawn aside and the cube made of them; a capture the engine could not start yet
 *  is asked again at the next look, any other failure is said once. */
async function drawScene(h: SceneHolds, host: SceneCaptureHost, input: SkyLightInputs) {
  const t = h.targets(),
    { state } = h
  if (!t || t.width !== input.width) return
  state.due = false
  state.running = true
  const { part } = input
  const near = part.light.skyDistanceThreshold / 100
  try {
    await host.captureHdrViews({
      size: t.width * part.quality.skyLightCaptureSupersample,
      cameras: Array.from({ length: CUBE_FACES }, (_, face) =>
        faceViewCamera(face, input.position, near),
      ),
      overrides: skyLightCaptureOverrides(part),
      copy: (encoder, lit, drawn, allocated, face) =>
        copyFace(h, encoder, t, part, lit, drawn, allocated, face),
    })
    // The cube was made again, or the light disposed, while the faces were drawn.
    if (h.targets() === t) {
      finish(h, t)
      state.done = true
    }
  } catch (error) {
    state.due = retryable(error)
    if (!state.due) h.failed(error)
  } finally {
    state.running = false
  }
}

/**
 * The scene capture of a sky light: `due` looks at the light, `run` draws the six faces and makes
 * the cube, `recapture` asks one, `forget` starts over when the cube is made again.
 */
export function createSceneCapture(
  device: GPUDevice,
  failed: (error: unknown) => void,
  stage: FilterStage,
  pipelines: () => CubemapPipelines,
  targets: () => SkyLightTargets | undefined,
) {
  const h: SceneHolds = {
    device,
    pipelines,
    failed,
    stage,
    targets,
    state: newSceneCaptureState(),
    words: createCopyWords(),
  }
  return {
    /** Looks at this frame's light: whether a capture is due now. */
    due: (input: SkyLightInputs) => lookAtScene(h.state, input) && pipelines().sceneReady(),
    run: (host: SceneCaptureHost, input: SkyLightInputs) => drawScene(h, host, input),
    recapture: () => recaptureScene(h.state),
    forget: () => forgetScene(h.state),
    get done() {
      return h.state.done
    },
  }
}
