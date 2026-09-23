import { decomposeMatrix4, invertMatrix4 } from '../sdk-core/src/index.ts';
import { copyElements, type HostNodeMatrix, type MatrixElements } from './matrixElements.ts';
import {
  writeEngineCamera,
  type CameraOptics,
  type EngineCamera,
  type OrthographicBox,
} from './engineCamera.ts';
import type { ControlVector } from './cameraControlTypes.ts';
import type { HostRotation } from './hostGraphNodes.ts';

export {
  createEngineCamera,
  defaultEngineCamera,
  holdCameraWorld,
  type EngineCamera,
} from './engineCamera.ts';

/**
 * THE CAMERA-POSE CONTRACT. Unique home of a camera's world pose in `sdk-browser`;
 * `tests/integration/structure-moteur.test.ts` forbids any other module from resolving it or
 * reading a camera's local pose, and names the consumers allowed to read the resolved pose.
 * It is also where the host camera is named BY SHAPE, once: `tests/integration/moteur-sans-three.test.ts`
 * holds that nobody else turns one into an engine camera.
 *
 * THE FACT. The engine does not own the camera: the host hands it over every frame, and it
 * may be the child of a rig that belongs to no prepared scene. `updateWorlds` only walks
 * the scene, so no one but the host walks that rig, and the host is not required to. Reading
 * `position`, `quaternion` or `matrixWorld` without having resolved the ancestor chain then
 * describes a different camera from the one the frame is drawn from.
 *
 * THE RULE, in three steps.
 *  1. RESOLVE. `resolveCameraWorld` is the only way to make the world pose current, ancestors
 *     included. Frame entry reads it ONCE, before anything else. A function callable on its
 *     own — oracle, bench, diagnostic, test host — also reads it first: it cannot know who
 *     calls it. The operation is idempotent and has no side effect outside the host graph: it only
 *     reads local matrices the engine does not write, so calling it again downstream changes
 *     no number. That is what lets the two uses coexist without contradicting each other.
 *  2. COPY. `readCameraWorld` resolves then copies, once per frame, the host camera's world
 *     matrix and declared optics into an `EngineCamera` the engine owns (`engineCamera.ts`) —
 *     allocated once, rewritten every frame. Derived matrices (projection, view,
 *     view-projection, frustum planes, world position) are set there, once for the whole frame.
 *  3. READ. Everything downstream reads the `EngineCamera`. `cameraWorldPosition` and
 *     `cameraPose` remain the pose reads of traces and test hosts. A direct read of
 *     `camera.position` is a defect, never an optimisation — under a rig it names a point
 *     that does not exist in the world.
 *
 * WHAT THE CONTRACT GUARANTEES ABOUT FRAME REVISIONS. Nothing here reads or increments a
 * revision: neither `scene`, nor `resources`, nor `view`. The pose enters the decision to
 * hold or replay a frame by a single path, the view fingerprint (`frameViewRevision.ts`,
 * which the WebGL gate calls `viewChanged`), which compares the sixteen numbers of the view.
 * ORDER is therefore the guarantee: frame entry copies the pose BEFORE the adaptive threshold
 * (`resolvePixelError`) and BEFORE the view fingerprint, and the fingerprint is reread BEFORE
 * the hold decision. A rig the host moves without touching the camera thus moves the
 * fingerprint and replays the frame; without the prior resolve, the fingerprint would see
 * nothing move and the frame would be held wrongly. A resolve done downstream, for its part,
 * neither opens nor closes any gate: it reaches no revision.
 */

/** Last eye position, kept from frame to frame to derive a velocity. */
export type CameraMotion = { last?: Float64Array; lastMs?: number };

/**
 * THE CAMERA THE HOST HANDS TO THE ENGINE, named by shape and by this file alone.
 *
 * What the engine READS of it: the world pose its own graph resolves, and the optics it
 * declares. What the engine WRITES on it: nothing a FRAME writes. The pose setters, `lookAt`
 * and the matrix a campaign restore puts back are the host's own gestures — framing, home,
 * controls, the view a measurement came from — which the explorer performs on the host's behalf
 * at the boundary; a frame never touches them.
 *
 * `updateWorldMatrix` is asked to make the world matrix current, ancestors included. Any host
 * object of this shape satisfies the contract, whatever library it comes from.
 *
 * WHY `lookAt` TAKES A `ControlVector` AND NOT THREE READ-ONLY NUMBERS. A host library aims a
 * camera through a vector of its own and tells it apart from a triple of numbers by a flag of
 * its own; handed a plain `{ x, y, z }` literal it reads the object as the first number and
 * composes a world matrix of `NaN`. Asking for the whole vector vocabulary — which no literal
 * satisfies and every host point of this package already offers (`hostGraphObjects.hostPoint`) —
 * puts that back under the compiler without naming any library.
 */
export type HostCamera = {
  /** LOCAL pose, as the host stores it: what its controls write, never what a frame reads. */
  readonly position: ControlVector;
  readonly quaternion: HostRotation;
  /** Optics the host declares; the engine composes its own projection from them. */
  fov: number;
  aspect: number;
  near: number;
  far: number;
  zoom: number;
  /** The box an orthographic camera sees; absent or null for a perspective one. */
  orthographic?: OrthographicBox | null;
  /** False when the host poses the camera by matrix: `matrix` IS the pose and nothing
   *  recomposes it from the three local fields. */
  matrixAutoUpdate: boolean;
  /** LOCAL matrix, the other face of the pose: what a restore puts back beside the three fields. */
  readonly matrix: HostNodeMatrix;
  readonly matrixWorld: MatrixElements;
  /** Projection in the HOST's depth convention, finite far plane included. The engine composes
   *  its own (`engineCamera.ts`) and reads this one only for a draw the host renderer owns. */
  readonly projectionMatrix: MatrixElements;
  /** Its inverse, which the host renderer keeps beside it and hands its own shaders. */
  readonly projectionMatrixInverse?: MatrixElements;
  updateWorldMatrix(ancestors: boolean, descendants: boolean): void;
  updateMatrixWorld(force?: boolean): void;
  updateProjectionMatrix(): void;
  lookAt(target: ControlVector): void;
  /** A view of its own the host keeps — the pose a measurement campaign comes back to. */
  clone(): HostCamera;
};
export type HostDrawCamera = {
  projection: Float32Array;
  world: Float64Array;
  view: Float64Array;
  eye: Float32Array;
};
export const createHostDrawCamera = (): HostDrawCamera => ({
  projection: new Float32Array(16),
  world: new Float64Array(16),
  view: new Float64Array(16),
  eye: new Float32Array(3),
});

/** What resolving a world pose asks of a host object, and nothing more: a camera, a rig, a node. */
export type HostResolvable = { updateWorldMatrix(ancestors: boolean, descendants: boolean): void };

export function resolveCameraWorld<T extends HostResolvable>(camera: T): T {
  camera.updateWorldMatrix(true, false);
  return camera;
}

/** Optics of the camera being read, rewritten in place: a frame allocates nothing here. */
const optics: CameraOptics = { fov: 0, aspect: 1, near: 0, far: 0, zoom: 1 };

/**
 * Copies the host camera into the engine camera, ancestors resolved. The POSE comes from
 * the host, the PROJECTION does not: the engine composes it from the declared optics
 * (field, aspect, near plane, zoom) in its own depth convention — reversed, infinite far
 * plane — because the host matrix carries its library's and a finite far plane. `camera.far`
 * is still read as-is for what still depends on it (adaptive threshold, shadow range) and
 * for the frustum far plane, which keeps it; it no longer enters any depth. `writeEngineCamera`
 * then rebuilds the view by inverting the world matrix, the view-projection and the six
 * frustum planes, once for the whole frame.
 */
export function readCameraWorld(
  into: EngineCamera,
  camera: HostCamera,
  /** Aspect ratio the view is drawn at, when it is not the one the camera declares: a capture
   *  renders the SAME camera aside, at the shape of the surface it writes into. */
  aspect = camera.aspect,
): EngineCamera {
  resolveCameraWorld(camera);
  copyElements(into.world, camera.matrixWorld.elements);
  optics.fov = camera.fov;
  optics.aspect = aspect;
  optics.near = camera.near;
  optics.far = camera.far;
  optics.zoom = camera.zoom;
  optics.orthographic = camera.orthographic;
  return writeEngineCamera(into, optics);
}

/**
 * Flat camera matrices for a draw that retains the host renderer's finite-depth projection.
 * The view is the inverse of the world matrix, inverted into the buffer the engine owns
 * (`invertMatrix4`, `sdk-core`): the host's own inverse is its business, and nothing here
 * writes on the camera it was handed.
 */
export function readHostDrawCamera(into: HostDrawCamera, camera: HostCamera) {
  resolveCameraWorld(camera);
  into.projection.set(camera.projectionMatrix.elements);
  into.world.set(camera.matrixWorld.elements);
  invertMatrix4(into.view, into.world);
  into.eye.set(into.world.subarray(12, 15));
  return into;
}

const poseTranslation = new Float64Array(3),
  poseRotation = new Float64Array(4),
  poseScale = new Float64Array(3);

/**
 * World pose that traces and diagnostics publish, read from the engine camera: the eye is
 * the translation of `world`, and the core decomposition yields the bits of `Matrix4.decompose`,
 * of which `getWorldQuaternion` is only the call. No host camera enters here: the published
 * pose is that of the drawn frame, ancestors included, because `readCameraWorld` resolved it first.
 */
export function enginePose(cam: EngineCamera) {
  decomposeMatrix4(cam.world, poseTranslation, poseRotation, poseScale);
  return {
    position: [cam.eye[0], cam.eye[1], cam.eye[2]],
    quaternion: [poseRotation[0], poseRotation[1], poseRotation[2], poseRotation[3]],
  };
}
