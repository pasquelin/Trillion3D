import {
  createCameraFrame,
  IDENTITY_MATRIX4,
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
}

/** The optics a camera declares: what the projection is composed from. */
export type CameraOptics = { fov: number; aspect: number; near: number; far: number; zoom: number };

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
  perspectiveProjection(into.projection, optics.fov, optics.aspect, optics.near, optics.zoom);
  updateCameraFrame(into, into.projection, into.world, into.far);
  // The render frame is set here, in the same pass: what leaves in single precision will read
  // the view without translation, never an absolute view accompanied by relative worlds.
  updateRenderOriginFrame(into, into.view, into.projection, into.far);
  into.eye[0] = into.world[12];
  into.eye[1] = into.world[13];
  into.eye[2] = into.world[14];
  return into;
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
  return into;
}
