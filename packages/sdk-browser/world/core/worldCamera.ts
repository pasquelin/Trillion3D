import { Vector3 } from '../../../sdk-core/world/math/vector3.ts';
import { Quaternion } from '../../../sdk-core/world/math/quaternion.ts';
import type { Camera } from '../../../sdk-core/world/camera/camera.ts';
import type { HostCamera } from '../../cameraWorld.ts';
import type { OrthographicBox } from '../../engineCamera.ts';
import { createOrbitCameraControls } from '../../cameraOrbitControls.ts';
import { createFlyCameraControls } from '../../cameraFlyControls.ts';
import { createFirstPersonCameraControls } from '../../cameraFirstPersonControls.ts';
import { createTrackballCameraControls } from '../../cameraTrackballControls.ts';
import { createPanZoomCameraControls } from '../../cameraPanZoomControls.ts';

export type WorldControls = 'orbit' | 'fly' | 'firstPerson' | 'trackball' | 'panZoom' | 'none';

const position = new Vector3(),
  rotation = new Quaternion(),
  scale = new Vector3();

/**
 * Puts the world's camera on the one a session draws from: its world pose, ancestors resolved,
 * and its optics, at the shape of the canvas. The session's camera is its own object; the world's
 * is copied onto it number by number, never handed in.
 */
export function copyWorldCamera(camera: Camera, into: HostCamera, aspect: number) {
  camera.updateWorldMatrix(true, false);
  camera.matrixWorld.decompose(position, rotation, scale);
  into.position.set(position.x, position.y, position.z);
  into.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  into.fov = camera.fov;
  into.near = camera.near;
  into.far = camera.far;
  into.zoom = camera.zoom;
  into.aspect = aspect;
  const box =
    camera.projection === 'orthographic'
      ? { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom }
      : null;
  // The engine composes its own projection from the box (`engineCamera.ts`); the host
  // renderer that draws the WebGL2 path reads the host matrix, rewritten orthographic here, and
  // its flag, which turns its shading's view vector to the camera's axis.
  into.orthographic = box;
  (into as { isOrthographicCamera?: boolean }).isOrthographicCamera = !!box;
  into.updateProjectionMatrix();
  if (box) hostOrthographic(into.projectionMatrix.elements as number[], box, camera);
  into.updateMatrixWorld();
}

/** The host renderer's orthographic matrix — forward depth, `near` to −1 and `far` to 1 — of
 *  the box a camera sees, scaled by its zoom about the box centre. */
function hostOrthographic(out: number[], box: OrthographicBox, camera: Camera) {
  const x = (box.right + box.left) / 2,
    y = (box.top + box.bottom) / 2,
    w = (box.right - box.left) / 2 / camera.zoom,
    h = (box.top - box.bottom) / 2 / camera.zoom,
    depth = camera.far - camera.near;
  out.fill(0);
  out[0] = 1 / w;
  out[5] = 1 / h;
  out[10] = -2 / depth;
  out[12] = -x / w;
  out[13] = -y / h;
  out[14] = -(camera.far + camera.near) / depth;
  out[15] = 1;
}

/**
 * The CSS box a session draws at. A session's own loop tracks it; a world the page leads has
 * the world bring the drawing buffer — and with it the camera's aspect — to the box before
 * every frame it is asked for, whenever the box changed, the first frame included.
 */
export function createCanvasFit(canvas: HTMLCanvasElement, led: boolean) {
  let sizedWidth = 0,
    sizedHeight = 0;
  return {
    apply(session: { resize(width: number, height: number): void }) {
      const width = Math.floor(canvas.clientWidth),
        height = Math.floor(canvas.clientHeight);
      if (!led || width < 1 || height < 1) return;
      if (width === sizedWidth && height === sizedHeight) return;
      sizedWidth = width;
      sizedHeight = height;
      session.resize(width, height);
    },
    /** A new session starts from its own default buffer: the next frame fits it again. */
    reset() {
      sizedWidth = sizedHeight = 0;
    },
  };
}

/** The controller a world drives its camera with, `none` for a page that poses it itself. */
export function worldControls(kind: WorldControls, camera: Camera, surface: HTMLElement) {
  switch (kind) {
    case 'orbit':
      return createOrbitCameraControls(camera, surface);
    case 'fly':
      return createFlyCameraControls(camera, surface);
    case 'firstPerson':
      return createFirstPersonCameraControls(camera, surface);
    case 'trackball':
      return createTrackballCameraControls(camera, surface);
    case 'panZoom':
      return createPanZoomCameraControls(camera, surface);
    default:
      return null;
  }
}
