import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { skyLightCubeWidth, skyLightSource } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { createViewScale } from '../view/viewScale.ts'
import { createViewGpuTiming } from '../prepare/timing.ts'
import { NO_OVERRIDES } from '../backend/state/viewOverrides.ts'
import { breakMainHeld, createWebgpuView, type WebgpuView } from '../backend/state/view.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { ViewCamera } from '../../camera/world.ts'
import { CUBE_FACES } from '../../modules/sky/skyLight/layout.ts'
import { faceViewCamera } from '../../modules/sky/skyLight/captureScene.ts'
import { createSkyMeshes, type SkyMeshes } from '../../modules/sky/skyLight/skyMeshes.ts'
import { SKY_MESH_NEAR } from '../../modules/sky/skyLight/skyMeshWgsl.ts'
import { skyLightStateOf } from './skyLightState.ts'
import { skyNodes, skyOpen, sceneHasSkyMaterial } from './skyRoots.ts'

/**
 * THE SKY MESHES IN THE REAL-TIME SKY CAPTURE: while the sky light captures in real time and the scene has a
 * sky material for the main view (`sceneHasSkyMaterial`: a sky surface it draws), the faces of the capture show the scene's sky meshes in the place of the atmosphere. Before the main
 * view is drawn, each face is a light draw of the sky surfaces alone from the light's place, through the 90 degree camera of the face
 * (`Camera.showOnly` of `skyNodes`, none where a sky surface has no node, `skyOpen`): the blend pass's own plan, expansion and sky runs, called for the face's camera and targets, with no
 * lighting, shadow, fog, sky, cloud nor effect (`ViewOverrides.skyMeshCapture`, `encodeSkyMeshFace.ts`). The face's state, its cut and its
 * targets, is a view of its own (`persistentView.ts`), which only holds them. With the depth buffer (`skyLightDepthBuffer`, on) the draw
 * writes the depth of the meshes, which the cube keeps beside their image (`SkyMeshes.copyIn`) and the fog over the faces is laid at.
 * The image is taken into the layer of the meshes' cube, which the capture reads (`SkyLightInputs.skyMeshes`). As the capture does, it draws
 * `skyLightFacesPerFrame` faces an image where the quality settings slice it (`skyLightTimeSlicing`), all six else; the first images draw
 * all six, so that the cube is whole when it is first read. Where the scene has no sky material, or no real-time sky light, the views and
 * the cube are given up; an image that cannot draw (a capture in progress, a device lost, no cache) draws no face and gives up nothing.
 * A face that changes what the main view reads of the cube (an image taken into it once it is whole, a face given up) breaks the main view's hold, as a mirrored view does (`encodePlanarReflection.ts`); a face still waiting for a program breaks nothing.
 */

/** What the caller that owns the persistent views lends to draw and give up the faces' views (this module cannot import it: the frame it belongs to reaches this one). */
export interface PersistentViews {
  readonly render: (rt: WebgpuPagesRuntime, view: WebgpuView, camera: Camera, index: number) => void
  readonly resize: (view: WebgpuView, width: number, height: number) => void
  readonly remove: (rt: WebgpuPagesRuntime, view: WebgpuView) => Promise<void>
}

/** A face the meshes are drawn for: its camera and its view. */
interface Face {
  readonly camera: Camera
  readonly view: WebgpuView
  /** What the camera was last given: the place it stands at (scene metres) and the sky nodes it shows, none for every object. */
  placed?: string
  nodes?: readonly unknown[] | null
}

/** What a runtime holds of the sky meshes' capture. */
interface Held {
  readonly meshes: SkyMeshes
  readonly faces: Face[]
  /** The face the next image starts at. */
  next: number
  /** The list of the plan's sky surfaces (`BlendState.skyItems`) the faces threw on: they are not tried again until it is made again. */
  failedFor?: readonly unknown[]
}
const states = new WeakMap<WebgpuPagesRuntime, Held>()

/** The sky meshes' cube of `rt`, once it holds an image of every face; none while it does not, or where the scene draws none. */
export const skyMeshesOf = (rt: WebgpuPagesRuntime) => {
  const held = states.get(rt)
  return held?.meshes.ready ? held.meshes : undefined
}

function createFace(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  meshes: SkyMeshes,
  face: number,
  eye: readonly [number, number, number],
): Face {
  const camera = faceViewCamera(face, eye, SKY_MESH_NEAR) as Camera
  const view = createWebgpuView(
    meshes.width,
    meshes.width,
    createViewScale(1, rt.views.main.scale),
    true,
    {
      ...NO_OVERRIDES,
      // No exposure: the layer holds the radiance, which the capture multiplies by its pre-exposure (`SkyMeshes.drawFace`).
      post: false,
      skyMeshCapture: { depthBuffer: meshes.depthBuffer, empty: () => meshes.drop(face) },
      readLit: (encoder, lit, drawn, allocated, depth) =>
        meshes.copyIn(encoder, face, lit, drawn, allocated, depth),
    },
  )
  view.timing.gpuTiming = createViewGpuTiming(rt, device, view)
  rt.views.persistent.push(view)
  return { camera, view }
}

/** Gives the views and the cube of `held` up, the views' resources freed once the device has answered what they asked. */
function release(rt: WebgpuPagesRuntime, held: Held, views: PersistentViews) {
  for (const { view } of held.faces)
    views.remove(rt, view).catch((error) => rt.diag.diagnosticFailure('sky-meshes-failed', error))
  held.meshes.dispose()
}

/** Draws the sky meshes' faces of this image, before the main view's; a failure is said once and the faces are not drawn again until the scene's sky meshes change. */
export function renderSkyMeshes(rt: WebgpuPagesRuntime, main: ViewCamera, views: PersistentViews) {
  const held = states.get(rt)
  const { source } = skyLightStateOf(rt)
  const { device } = rt.gpu
  const wanted =
    !!source &&
    !!device &&
    skyLightSource(source.part) === 'realTime' &&
    sceneHasSkyMaterial(rt, main._viewSet, true)
  const width = wanted ? skyLightCubeWidth(source.part, device.limits.maxTextureDimension2D) : 0
  const depthBuffer = wanted && source.part.quality.skyLightDepthBuffer
  if (held && (!wanted || held.meshes.width !== width || held.meshes.depthBuffer !== depthBuffer)) {
    release(rt, held, views)
    states.delete(rt)
  }
  // An image in the middle of a capture, on a lost device or without the cache draws no face: the views and the cube stay as they are.
  if (!wanted || rt.capture.capturing || rt.run.lost || !rt.gpu.cache) return
  const { quality } = source.part
  const items = rt.blendState.skyItems
  // The views are cut to the sky nodes while each sky surface has one; a sky surface an HLOD actor wears has none, and nothing is cut.
  const nodes = skyOpen(rt) ? null : skyNodes(rt)
  let at = states.get(rt)
  if (!at) {
    const meshes = createSkyMeshes(device, width, depthBuffer)
    at = { meshes, faces: [], next: 0 }
    states.set(rt, at)
  }
  if (at.failedFor === items) return
  // The plan's sky surfaces were made again since the faces failed: they are given another chance.
  at.failedFor = undefined
  const place = source.position
  const placed = place.join()
  if (at.faces.length === 0)
    for (let face = 0; face < CUBE_FACES; face++)
      at.faces.push(createFace(rt, device, at.meshes, face, place))
  const count =
    at.meshes.ready && quality.skyLightTimeSlicing ? quality.skyLightFacesPerFrame : CUBE_FACES
  // The frame counts as held when every view's is; a view's own answer is read alone, then joined back.
  const { run } = rt
  const outer = run.frameHeld
  const { meshes } = at
  let broke = false
  try {
    for (let k = 0; k < count; k++) {
      const face = (at.next + k) % CUBE_FACES
      const held = at.faces[face]
      const { camera, view } = held
      if (held.placed !== placed) {
        camera.matrix.elements.set(faceViewCamera(face, place, SKY_MESH_NEAR).matrix.elements)
        held.placed = placed
      }
      if (held.nodes !== nodes) {
        camera.showOnly = nodes
        held.nodes = nodes
      }
      views.resize(view, width, width)
      run.frameHeld = true
      const wasReady = meshes.ready,
        revision = meshes.revision
      views.render(rt, view, camera, face)
      // The main view reads the cube once it is whole: it is drawn again only when a face changed what it reads (an image handed in, a face given up).
      broke ||= breakMainHeld(rt, (wasReady || meshes.ready) && meshes.revision !== revision)
    }
  } catch (error) {
    rt.diag.diagnosticFailure('sky-meshes-failed', error)
    at.failedFor = items
  } finally {
    run.frameHeld = outer && !broke
  }
  at.next = (at.next + count) % CUBE_FACES
}

/** The session's sky meshes given up with it: the persistent views are released whole by the session, the cube is destroyed. */
export function disposeSkyMeshes(rt: WebgpuPagesRuntime) {
  const held = states.get(rt)
  if (!held) return
  held.meshes.dispose()
  states.delete(rt)
}
