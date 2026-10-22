import { Camera } from '../../../../../sdk-core/src/world/camera/camera.ts'
import type { SkyLightPart } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { HostCamera } from '../../../camera/world.ts'
import type { HdrViewsJob } from '../../../frame/io/hdrCapture.ts'
import type { ViewOverrides } from '../../../frame/backend/state/viewOverrides.ts'
import { COPY_LAYOUT } from './copyWgsl.ts'
import { writeBlock, type SkyLightInputs } from './captureInputs.ts'
import { filter, harmonics, mipChain, type FilterStage } from './captureFilter.ts'
import type { CubemapPipelines } from './cubemapPipelines.ts'
import {
  forgetScene,
  lookAtScene,
  newSceneCaptureState,
  recaptureScene,
} from './captureSceneSchedule.ts'
import { BLOCK_STRIDE, CUBE_FACES, FACES, cubeToScene } from './layout.ts'
import type { SkyLightTargets } from './targets.ts'

/**
 * THE CAPTURE OF A SCENE INTO THE SKY LIGHT'S CUBE (`'capturedScene'`): the scene drawn aside
 * from the light's position through six cameras, the faces of a cube, the lit image of each taken
 * into the face of the captured cube, then the same mips, filter and harmonics as any other source
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
 *  not the scene's own — the lights, as lit (the emissive-only capture has none) —, every surface
 *  rough and, for an emissive-only capture, black in its diffuse and its specular colour, no
 *  particle, shaft, light function nor effect (`ViewOverrides`). The detail asked is the quality's
 *  scale, 1 when it is not above zero. */
export function skyLightCaptureOverrides(part: SkyLightPart): ViewOverrides {
  const { light, quality } = part
  const emissiveOnly = light.captureEmissiveOnly
  const scale = quality.skyLightCaptureLodDistanceScale
  return {
    skyLighting: false,
    lighting: !emissiveOnly,
    reflections: quality.skyLightCaptureReflections,
    roughness: { min: 1, range: 0 },
    diffuse: emissiveOnly ? [0, 0, 0, 0] : undefined,
    specular: emissiveOnly ? [0, 0, 0, 0] : undefined,
    particles: false,
    lightShafts: false,
    lightFunctions: false,
    post: false,
    staticSceneOnly: light.mobility === 'static',
    lodScale: scale > 0 ? scale : 1,
  }
}

const cross = (a: readonly number[], b: readonly number[]) =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as const

/**
 * The camera of face `face` standing at `eye` (scene metres): square, a field of 90 degrees, its
 * nearest distance `near`, no farthest (the projection is infinite). It looks along the face and its up is the face's, in the scene's axes
 * (`cubeToScene`); its right is the one a camera has, the face's reversed — a cube's faces are laid
 * as seen from outside, a camera sees them from inside —, which the copy turns back.
 */
export function faceHostCamera(face: number, eye: readonly number[], near: number): HostCamera {
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
  readonly floats: Float32Array
  readonly uints: Uint32Array
  sampler?: GPUSampler
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
  const { at } = COPY_LAYOUT,
    { light } = part,
    made = h.pipelines()
  h.uints.set([face, light.lowerHemisphereIsSolidColor ? 1 : 0, 0, 0], at.face)
  h.floats.set([0, 0, 1 / t.width, 0], at.rotation)
  h.floats.set([...light.lowerHemisphereColor, 1], at.lower)
  h.floats.set([drawn[0] / allocated[0], drawn[1] / allocated[1], 1, 1], at.scale)
  const offset = face * BLOCK_STRIDE
  writeBlock(h.device, t.blocks.copy, offset, h.floats)
  h.sampler ??= h.device.createSampler({
    label: 'Trillion3D sky light scene',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const source = h.device.createBindGroup({
    layout: made.layouts.scene,
    entries: [
      { binding: 2, resource: lit },
      { binding: 3, resource: h.sampler },
    ],
  })
  const block = h.device.createBindGroup({
    layout: made.layouts.block,
    entries: [{ binding: 0, resource: { buffer: t.blocks.copy, size: COPY_LAYOUT.words * 4 } }],
  })
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D sky light scene copy',
    colorAttachments: [
      {
        view: t.faceTargets[face],
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(made.pipelines.copyScene.get())
  pass.setBindGroup(0, source)
  pass.setBindGroup(1, block, [offset])
  pass.draw(3)
  pass.end()
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

/** The mips, the filter and the harmonics of the captured cube, in one submit. */
function finish(h: SceneHolds, t: SkyLightTargets) {
  const encoder = h.device.createCommandEncoder({ label: 'Trillion3D sky light scene' })
  h.stage.slot = 0
  mipChain(h.stage, encoder, t)
  filter(h.stage, encoder, t, 0, 0, t.mips - 1, 0, CUBE_FACES)
  harmonics(h.stage, encoder, t, 0)
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
        faceHostCamera(face, input.position, near),
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
  const words = new ArrayBuffer(COPY_LAYOUT.words * 4)
  const h: SceneHolds = {
    device,
    pipelines,
    failed,
    stage,
    targets,
    state: newSceneCaptureState(),
    floats: new Float32Array(words),
    uints: new Uint32Array(words),
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

/** The scene capture (`createSceneCapture`). */
export type SceneCapture = ReturnType<typeof createSceneCapture>
