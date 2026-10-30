import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { ResolvedPlanarReflection } from '../../../../sdk-core/src/scene/planarReflection/contracts.ts'
import { readCameraWorld, type ViewCamera } from '../../camera/world.ts'
import { createEngineCamera, type EngineCamera } from '../../camera/engineCamera.ts'
import { createViewScale } from '../view/viewScale.ts'
import { createViewGpuTiming } from '../prepare/timing.ts'
import { NO_OVERRIDES, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import {
  breakHeldFrame,
  breakMainHeld,
  createWebgpuView,
  viewGpu,
  type WebgpuView,
} from '../backend/state/view.ts'
import {
  removeWebgpuView,
  renderWebgpuView,
  resizeWebgpuView,
} from '../backend/state/persistentView.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { screenSpaceFrameInputs } from '../../lighting/screenSpaceTracing/stage.ts'
import { releaseShadowDenoise } from '../../lighting/shadows/denoise/shadowDenoiseFrame.ts'
import { releaseFirstPersonSelfShadow } from '../../lighting/shadows/firstPerson/selfShadow.ts'
import { releaseRayTracedLocal } from '../../lighting/shadows/rayTraced/rayTracedLocal.ts'
import { releaseObjectShadows } from '../../lighting/shadows/perObject/objectShadowFrame.ts'
import { releaseFieldShadow } from '../../lighting/shadows/classic/fieldShadow/fieldShadowKit.ts'
import { releaseViewVolumes } from '../../lighting/heterogeneousVolumes/liveShadingState.ts'
import {
  createPlanarGpu,
  destroyPlanarGpu,
  encodePlanarComposite,
  encodePlanarPrefilter,
  type PlanarGpu,
} from '../../lighting/planarReflection/held.ts'
import {
  mirroredCameraMatrix,
  planarBoxInFrustum,
  planarImageSize,
  planarPlane,
  planeDistance,
  widenedField,
  type PlanarPlane,
} from '../../lighting/planarReflection/mirror.ts'
import {
  createPlanarPipelines,
  type PlanarPipelines,
} from '../../lighting/planarReflection/pipelines.ts'

/**
 * THE PLANAR REFLECTIONS IN THE FRAME (`context.scenePlanarReflection`). Before the main view is drawn, each reflection the viewer faces and whose box meets the view's
 * frustum draws the scene again from the camera reflected across its plane, in a view of its own beside the main one (`persistentView.ts`), clipped to the viewer's
 * side of the plane (`Camera.clipPlane`, where the project switch `cutClipPlane` is on) and without the temporal jitter, at its percentage of the main view's size,
 * lit by the lights and the sky light, with no reflection, shaft or effect of its own. The lit image it hands over (`ViewOverrides.readLit`) is prefiltered
 * into the reflection image (`encodePlanarPrefilter`). Once the main view has traced its reflections, each reflection's image is laid over them
 * (`encodePlanarReflections`), the one reflection the opaque surfaces read, in the order the reflections were added. The main view alone reads them.
 */

/** A planar reflection the frame keeps: its mirrored view and camera, the planar reflection it draws for and what that holds on the GPU. */
interface Held {
  reflection: ResolvedPlanarReflection
  plane: PlanarPlane
  readonly view: WebgpuView
  readonly camera: Camera
  readonly gpu: PlanarGpu
  /** Whether the mirrored view draws this image: the viewer faces the plane and its box meets the frustum. */
  active: boolean
  /** The size the mirrored view is resized to, none yet. */
  size?: readonly [number, number]
  /** The mirrored view failed to draw: it is not tried again, nor its image composited, until the reflection or the image's size changes. */
  failed: boolean
}

/** What a runtime holds of its planar reflections. */
interface PlanarState {
  readonly pipelines: PlanarPipelines
  readonly held: Map<string, Held>
  /** The main camera as the engine reads it, rewritten before each image. */
  readonly main: EngineCamera
  /** The target's first layer, as a 2D view, for the target it was made on. */
  layer?: { target: GPUTexture; view: GPUTextureView }
}
const states = new WeakMap<WebgpuPagesRuntime, PlanarState>()

/** The overrides of a mirrored view: lit by the lights and the sky light, no traced reflection nor light shaft, no effect, exposure nor finishing. */
const mirroredOverrides = (readLit: ViewOverrides['readLit']): ViewOverrides => ({
  ...NO_OVERRIDES,
  reflections: false,
  lightShafts: false,
  post: false,
  readLit,
})

function createHeld(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  state: PlanarState,
  reflection: ResolvedPlanarReflection,
): Held {
  const { id } = reflection
  const gpu = createPlanarGpu(device)
  const camera = new Camera('perspective', { far: Infinity })
  camera.matrixAutoUpdate = false
  const plane = planarPlane(reflection)
  setViewSet(camera, plane, reflection.hidden)
  const view = createWebgpuView(
    1,
    1,
    createViewScale(1, rt.views.main.scale),
    true,
    mirroredOverrides((encoder, lit, drawn, allocated, depth) => {
      const held = state.held.get(id)
      if (!held) return
      const cam = rt.run.gate.cam
      encodePlanarPrefilter(
        device,
        encoder,
        state.pipelines,
        held.gpu,
        held.reflection,
        held.plane,
        cam,
        lit,
        depth,
        drawn,
        allocated,
      )
    }),
  )
  view.timing.gpuTiming = createViewGpuTiming(rt, device, view)
  // Among the persistent views from the start, parked until it is seen.
  view.parked = true
  rt.views.persistent.push(view)
  return {
    reflection,
    plane,
    view,
    camera,
    gpu,
    active: false,
    failed: false,
  }
}

/** Gives the mirrored view of `held` up: its view leaves the persistent ones, and its GPU resources are freed once the device has answered what the view asked. */
function release(rt: WebgpuPagesRuntime, held: Held) {
  removeWebgpuView(rt, held.view)
    .catch((error) => rt.diag.diagnosticFailure('planar-reflection-failed', error))
    .finally(() => destroyPlanarGpu(held.gpu, !states.has(rt)))
}

function releaseAll(rt: WebgpuPagesRuntime, state: PlanarState) {
  for (const held of state.held.values()) release(rt, held)
  state.held.clear()
}

/** The clip plane and the hidden objects of a mirrored `camera`: the plane keeps the viewer's side, and `hidden` are the objects the reflection leaves out. */
function setViewSet(camera: Camera, plane: PlanarPlane, hidden: readonly Object3D[]) {
  camera.clipPlane = { base: plane.origin, normal: plane.normal }
  camera.hidden = hidden
}

/** Draws the mirrored view of `held`, from the main camera `main`, at `percentage` of the main view's size `drawn`; a failure is said once. */
function drawMirrored(
  rt: WebgpuPagesRuntime,
  held: Held,
  main: EngineCamera,
  drawn: readonly number[],
  index: number,
) {
  const { reflection, plane, camera, view } = held
  const [width, height] = planarImageSize(drawn[0], drawn[1], reflection.screenPercentage)
  if (held.size?.[0] !== width || held.size[1] !== height) {
    resizeWebgpuView(view, width, height)
    held.size = [width, height]
    held.failed = false
  }
  if (held.failed) return
  mirroredCameraMatrix(camera.matrix.elements as Float64Array, main.world, plane)
  const fov = widenedField(main.projection, main.aspect, reflection.extraFov)
  if (camera.fov !== fov) camera.fov = fov
  if (camera.near !== main.near) camera.near = main.near
  // The frame counts as held when every view's is: this view's own answer is read alone, then joined back.
  const { run } = rt
  const outer = run.frameHeld
  run.frameHeld = true
  try {
    renderWebgpuView(rt, view, camera, index)
    // An image the mirrored view drew is not the one the main view composited: the main view is drawn again.
    breakMainHeld(rt)
  } catch (error) {
    rt.diag.diagnosticFailure('planar-reflection-failed', error)
    held.failed = true
    // The image of a view that failed is not composited.
    held.gpu.drawn = false
  } finally {
    run.frameHeld &&= outer
  }
}

/**
 * The mirrored views drawn before the main view of this image (`camera` is what the main view is drawn from): the reflections added since are made,
 * the ones removed given up, and each that is seen draws its image. Nothing for a camera that is not a perspective one, nor while a capture holds the engine.
 */
export function renderPlanarReflections(rt: WebgpuPagesRuntime, camera: ViewCamera) {
  const store = rt.context.scenePlanarReflection
  const device = rt.gpu.device
  let state = states.get(rt)
  if (!store || !device) return
  if (store.count === 0) {
    if (state) releaseAll(rt, state)
    return
  }
  if (rt.capture.capturing || rt.run.lost || !rt.gpu.cache) return
  state ??= (() => {
    const made = {
      pipelines: createPlanarPipelines(device, (error) =>
        rt.diag.diagnosticFailure('planar-reflection-failed', error),
      ),
      held: new Map<string, Held>(),
      main: createEngineCamera(),
    }
    states.set(rt, made)
    return made
  })()
  const { viewport } = rt.setup
  const main = readCameraWorld(state.main, camera, viewport[0] / viewport[1], rt.context, viewport)
  const live = new Set<string>()
  const drawn = viewGpu(rt, rt.views.main).targetSize
  let index = 0
  for (const reflection of store.values) {
    live.add(reflection.id)
    let held = state.held.get(reflection.id)
    if (held) {
      // The store holds a new object when one changed.
      if (held.reflection !== reflection) {
        held.reflection = reflection
        held.plane = planarPlane(reflection)
        setViewSet(held.camera, held.plane, reflection.hidden)
        held.failed = false
        // The image it held was drawn under the settings before.
        breakHeldFrame(rt, held.view)
      }
    } else state.held.set(reflection.id, (held = createHeld(rt, device, state, reflection)))
    // The viewer faces the plane and the reflection's box meets the view's frustum; a perspective camera only.
    held.active =
      main.perspective !== 0 &&
      planeDistance(held.plane, main.eye[0], main.eye[1], main.eye[2]) > 0 &&
      planarBoxInFrustum(held.plane, main.planes)
    // Parked while it draws nothing or has failed (its resources are kept); every sweep over the persistent views still reaches it.
    const parked = !held.active || held.failed
    // The cut it adopted before, and the readback still pending beside it, are of the residency before the park: it draws from a readback asked after the park, never from those.
    if (held.view.parked && !parked) {
      if (held.view.cut) held.view.cut.adopted = undefined
      held.view.run.asideCut?.dispose()
      held.view.run.asideCut = undefined
    }
    // A view that stops drawing runs no image to trim its shadow state: it lets go of the traced lights', the denoiser's, the self shadow's, the field cascade's and the heterogeneous volumes' memory (and its place among the scene's holders) when it parks.
    if (parked && !held.view.parked) {
      releaseRayTracedLocal(held.view.gpu)
      releaseFieldShadow(held.view.gpu)
      releaseObjectShadows(held.view.gpu)
      releaseViewVolumes(held.view.gpu)
      releaseFirstPersonSelfShadow(held.view.gpu)
      releaseShadowDenoise(held.view.gpu)
    }
    held.view.parked = parked
    if (held.active) drawMirrored(rt, held, main, drawn[0] > 0 ? drawn : viewport, index++)
  }
  for (const [id, held] of state.held)
    if (!live.has(id)) {
      release(rt, held)
      state.held.delete(id)
    }
}

/** The session's planar reflections given up with it: their mirrored views are counted again, and the session releases the persistent ones whole, and their images are destroyed. */
export function disposePlanarReflections(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  if (!state) return
  for (const held of state.held.values()) {
    held.view.parked = false
    destroyPlanarGpu(held.gpu, true)
  }
  states.delete(rt)
}

/** The first layer of the reflection target `target` as a 2D view, kept for the target it was made on. */
function firstLayer(state: PlanarState, target: GPUTexture) {
  if (state.layer?.target !== target)
    state.layer = {
      target,
      view: target.createView({ dimension: '2d', baseArrayLayer: 0, arrayLayerCount: 1 }),
    }
  return state.layer.view
}

/**
 * The planar reflections laid over the reflection target of the main view, once its reflections are made (`ran`: `'scene'` where the rays' share and the environment
 * are in the target, `'screen'` where the screen's reflection already holds the environment; none where the image made none): each reflection that is seen,
 * in the order they were added, reads its image for every opaque pixel and puts it over what the target holds, planar reflections winning over the rest.
 */
export function encodePlanarReflections(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  ran: 'scene' | 'screen' | undefined,
) {
  const state = states.get(rt)
  const reflection = rt.gpu.reflection
  if (!state || !ran || !reflection || rt.views.active !== rt.views.main) return
  const isSeen = ({ active, gpu }: Held) => active && gpu.drawn
  let seen = false
  for (const held of state.held.values()) seen ||= isSeen(held)
  if (!seen) return
  const inputs = screenSpaceFrameInputs(rt, device, cam)
  if (!inputs) return
  const layer = firstLayer(state, reflection.target)
  for (const held of state.held.values())
    if (isSeen(held))
      encodePlanarComposite(
        device,
        encoder,
        state.pipelines,
        held.gpu,
        held.reflection,
        held.plane,
        inputs,
        layer,
        ran,
      )
}
