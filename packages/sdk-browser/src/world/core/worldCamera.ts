import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { HostCamera } from '../../camera/world.ts'
import { createOrbitCameraControls } from '../../camera/controls/orbitControls.ts'
import { createFlyCameraControls } from '../../camera/controls/flyControls.ts'
import { createFirstPersonCameraControls } from '../../camera/controls/firstPersonControls.ts'
import { createCharacterCameraControls } from '../../camera/controls/characterControls.ts'
import { createVehicleCameraControls } from '../../camera/controls/vehicleControls.ts'
import { createTrackballCameraControls } from '../../camera/controls/trackballControls.ts'
import { createPanZoomCameraControls } from '../../camera/controls/panZoomControls.ts'

/**
 * The ways a page can steer the camera with the mouse and keyboard, or `'none'`. `'firstPerson'`
 * moves a camera; `'character'` moves a body — mass, gravity, jumps, collisions with
 * `world.controls.colliders` — and looks through its eyes. `'fly'` and `'firstPerson'` move at
 * `world.controls.movementSpeed` and turn at `world.controls.lookSpeed`.
 */
export type WorldControls =
  'orbit' | 'fly' | 'firstPerson' | 'character' | 'vehicle' | 'trackball' | 'panZoom' | 'none'

const position = new Vector3(),
  rotation = new Quaternion(),
  scale = new Vector3()

/** The shape a frame is drawn at: the canvas's drawing buffer, its width over its height. */
export const drawnAspect = (canvas: HTMLCanvasElement) => canvas.width / Math.max(1, canvas.height)

/**
 * Puts the world's camera on the one a session draws from: its world pose, ancestors resolved,
 * and its optics, at the shape of the canvas. The session's camera is its own object; the world's
 * is copied onto it number by number, never handed in.
 */
function copyWorldCamera(camera: Camera, into: HostCamera, aspect: number) {
  camera.updateWorldMatrix(true, false)
  camera.matrixWorld.decompose(position, rotation, scale)
  into.position.set(position.x, position.y, position.z)
  into.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
  into.fov = camera.fov
  into.near = camera.near
  into.far = camera.far
  into.zoom = camera.zoom
  into.aspect = aspect
  const { left, right, top, bottom, fitAspect } = camera
  const box = camera.projection === 'orthographic' ? { left, right, top, bottom, fitAspect } : null
  // The box is handed on as declared, fitted where the projection is composed, at the shape it
  // is drawn at: the engine composes its own projection from it (`engineCamera.ts`).
  into.orthographic = box
  into.updateProjectionMatrix()
  into.updateMatrixWorld()
}

/** Puts a session's camera on the page's `camera()`, at the shape of `canvas`: before the session
 *  reads anything for its first frame, then before every frame. */
export const followPageCamera =
  (camera: () => Camera, canvas: HTMLCanvasElement) => (into: HostCamera) =>
    copyWorldCamera(camera(), into, drawnAspect(canvas))

/**
 * The CSS box a session draws at. A session's own loop tracks it; a world the page leads has
 * the world bring the drawing buffer — and with it the camera's aspect — to the box before
 * every frame it is asked for, whenever the box changed, the first frame included.
 */
export function createCanvasFit(canvas: HTMLCanvasElement, led: boolean) {
  let sizedWidth = 0,
    sizedHeight = 0
  return {
    apply(session: { resize(width: number, height: number): void }) {
      const width = Math.floor(canvas.clientWidth),
        height = Math.floor(canvas.clientHeight)
      if (!led || width < 1 || height < 1) return
      if (width === sizedWidth && height === sizedHeight) return
      sizedWidth = width
      sizedHeight = height
      session.resize(width, height)
    },
    /** A new session starts from its own default buffer: the next frame fits it again. */
    reset() {
      sizedWidth = sizedHeight = 0
    },
  }
}

/** The controller a world drives its camera with, `none` for a page that poses it itself. */
export function worldControls(kind: WorldControls, camera: Camera, surface: HTMLElement) {
  switch (kind) {
    case 'orbit':
      return createOrbitCameraControls(camera, surface)
    case 'fly':
      return createFlyCameraControls(camera, surface)
    case 'firstPerson':
      return createFirstPersonCameraControls(camera, surface)
    case 'character':
      return createCharacterCameraControls(camera, surface)
    case 'vehicle':
      return createVehicleCameraControls(camera, surface)
    case 'trackball':
      return createTrackballCameraControls(camera, surface)
    case 'panZoom':
      return createPanZoomCameraControls(camera, surface)
    default:
      return null
  }
}
