import {
  createCameraFrame,
  IDENTITY_MATRIX4,
  orthographicProjection,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from '../sdk-core/index.ts';
import {
  createRenderOriginFrame,
  holdRenderOriginFrame,
  updateRenderOriginFrame,
  type RenderOriginFrame,
} from './cameraRenderOrigin.ts';

/**
 * The engine camera: the numbers of a frame, in owned buffers rewritten in place.
 * No host-library structure crosses a signature downstream of `readCameraWorld`
 * (`cameraWorld.ts`, the only translation from a host camera).
 */
export interface EngineCamera extends CameraFrame, RenderOriginFrame {
  /** World matrix of the camera, column-major. */
  world: Float64Array;
  /** Engine projection, composed from the optics the host declared: reversed depth, infinite
   *  far plane (`depthConvention.ts`). This is NOT the host camera's matrix. */
  projection: Float64Array;
  /** Eye position in the world: the translation of `world`. It is not named `position`,
   *  which everywhere else means the LOCAL pose the contract forbids reading. */
  eye: Float64Array;
  near: number;
  far: number;
  /** Vertical field in degrees and aspect ratio, as the host declares them. */
  fov: number;
  aspect: number;
  /** The projection's clip-w weight: a point at view depth d has w = perspective·d +
   *  (1 − perspective) — 1 under a perspective projection, 0 under an orthographic one. What
   *  a screen error divides by (`screenErrorBound.ts`). */
  perspective: number;
  /** The camera as ONE homogeneous point: `(eye, 1)` under a perspective projection, `(back, 0)`
   *  — the unit direction toward the camera — under an orthographic one. The vector from a
   *  point P toward the camera is `viewPoint.xyz − P·viewPoint.w` for both: the view vector of
   *  the shading and the normal-cone test read it, never the eye alone. */
  viewPoint: Float64Array;
}

/** The box an orthographic camera sees, in its own frame, before its zoom. */
export type OrthographicBox = { left: number; right: number; top: number; bottom: number };
/** The box `box` scaled by `zoom` about its centre, written in `into`: what the camera sees. */
export function zoomedBox(box: OrthographicBox, zoom: number, into: OrthographicBox) {
  const x = (box.right + box.left) / 2,
    y = (box.top + box.bottom) / 2,
    w = (box.right - box.left) / (2 * zoom),
    h = (box.top - box.bottom) / (2 * zoom);
  into.left = x - w;
  into.right = x + w;
  into.bottom = y - h;
  into.top = y + h;
  return into;
}
const seen: OrthographicBox = { left: 0, right: 0, top: 0, bottom: 0 };
/** The optics a camera declares: what the projection is composed from. An `orthographic` box
 *  makes the projection orthographic; `fov` then still sizes what reads a field of view. */
export type CameraOptics = {
  fov: number;
  aspect: number;
  near: number;
  far: number;
  zoom: number;
  orthographic?: OrthographicBox | null;
};

/** Optics of a camera nobody has set: the fallback of oracles called before the first frame. */
const DEFAULT_OPTICS: CameraOptics = { fov: 50, aspect: 1, near: 0.1, far: 2000, zoom: 1 };

export function createEngineCamera(): EngineCamera {
  return {
    ...createCameraFrame(),
    ...createRenderOriginFrame(),
    world: new Float64Array(16),
    projection: new Float64Array(16),
    eye: new Float64Array(3),
    near: 0,
    far: 0,
    fov: 0,
    aspect: 1,
    perspective: 1,
    viewPoint: new Float64Array(4),
  };
}

/**
 * Derives everything a frame reads from `into.world`, already set, and the declared optics:
 * the projection in the engine's depth convention, then the view, the view-projection and
 * the six frustum planes (`updateCameraFrame`), the render frame (`cameraRenderOrigin.ts`)
 * and the eye. `far` is kept for what still depends on it (adaptive threshold, shadow range,
 * frustum far plane); it enters no depth.
 */
export function writeEngineCamera(into: EngineCamera, optics: CameraOptics): EngineCamera {
  into.near = optics.near;
  into.far = optics.far;
  into.fov = optics.fov;
  into.aspect = optics.aspect;
  const box = optics.orthographic;
  if (box) {
    const { left, right, bottom, top } = zoomedBox(box, optics.zoom || 1, seen);
    orthographicProjection(into.projection, left, right, bottom, top, optics.near, optics.far);
  } else
    perspectiveProjection(into.projection, optics.fov, optics.aspect, optics.near, optics.zoom);
  updateCameraFrame(into, into.projection, into.world, into.far);
  // The render frame is set here, in the same pass: what leaves in single precision will read
  // the view without translation, never an absolute view accompanied by relative worlds.
  updateRenderOriginFrame(into, into.view, into.projection, into.far);
  into.eye[0] = into.world[12];
  into.eye[1] = into.world[13];
  into.eye[2] = into.world[14];
  writeViewPoint(into, box ? 0 : 1);
  return into;
}

/** `perspective` and `viewPoint` of a camera whose world and eye are set: the eye, or the
 *  camera's own +z — the way back toward it —, weighted by the projection. */
function writeViewPoint(into: EngineCamera, perspective: number) {
  const w = into.world,
    length = Math.hypot(w[8], w[9], w[10]) || 1,
    flat = (1 - perspective) / length;
  into.perspective = perspective;
  for (let axis = 0; axis < 3; axis++)
    into.viewPoint[axis] = into.eye[axis] * perspective + w[8 + axis] * flat;
  into.viewPoint[3] = perspective;
}

let defaultEngine: EngineCamera | undefined;
/** Engine camera at the origin with `DEFAULT_OPTICS`: the fallback of oracles the host calls
 *  before the first frame, where the engine has not yet copied any camera. */
export function defaultEngineCamera() {
  if (!defaultEngine) {
    defaultEngine = createEngineCamera();
    defaultEngine.world.set(IDENTITY_MATRIX4);
    writeEngineCamera(defaultEngine, DEFAULT_OPTICS);
  }
  return defaultEngine;
}

/**
 * Copies an engine camera into another, which then keeps the view bit for bit. A view held
 * from frame to frame (Hi-Z history) or rendered aside (second capture view) thus describes
 * the view actually drawn, even when the source is the child of a rig. Nothing is recomputed:
 * derived matrices are already set on the source.
 */
export function holdCameraWorld(into: EngineCamera, from: EngineCamera): EngineCamera {
  into.world.set(from.world);
  into.projection.set(from.projection);
  into.view.set(from.view);
  into.viewProjection.set(from.viewProjection);
  into.planes.set(from.planes);
  holdRenderOriginFrame(into, from);
  into.eye.set(from.eye);
  into.near = from.near;
  into.far = from.far;
  into.fov = from.fov;
  into.aspect = from.aspect;
  into.perspective = from.perspective;
  into.viewPoint.set(from.viewPoint);
  return into;
}
