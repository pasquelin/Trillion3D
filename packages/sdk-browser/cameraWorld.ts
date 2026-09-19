import * as THREE from 'three';
import {
  createCameraFrame,
  decomposeMatrix4,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from '../sdk-core/index.ts';
import { copyElements } from './matrixElements.ts';
import {
  createRenderOriginFrame,
  holdRenderOriginFrame,
  updateRenderOriginFrame,
  type RenderOriginFrame,
} from './cameraRenderOrigin.ts';

/**
 * THE CAMERA-POSE CONTRACT. Unique home of a camera's world pose in `sdk-browser`;
 * `test/integration/structure-moteur.test.mjs` forbids any other module from resolving it or
 * reading a camera's local pose, and names the consumers allowed to read the resolved pose.
 * It is also the only file on the per-frame path that names a host-library type:
 * `test/integration/moteur-sans-three.test.mjs` forbids `three` everywhere else on that path.
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
 *     calls it. The operation is idempotent and has no side effect outside Three: it only
 *     reads local matrices the engine does not write, so calling it again downstream changes
 *     no number. That is what lets the two uses coexist without contradicting each other.
 *  2. COPY. `readCameraWorld` resolves then copies, once per frame, the host camera's world
 *     matrix and projection matrix into an `EngineCamera` the engine owns — allocated once,
 *     rewritten every frame. Derived matrices (view, view-projection, frustum planes, world
 *     position) are set there, once for the whole frame.
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

/** The camera the host hands to the engine. Only this file names it. */
export type HostCamera = THREE.PerspectiveCamera;

/**
 * The engine camera: the numbers of a frame, in owned buffers rewritten in place.
 * No host-library structure crosses a signature downstream of `readCameraWorld`.
 */
export interface EngineCamera extends CameraFrame, RenderOriginFrame {
  /** Host-camera world matrix, copied as-is. */
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

export function resolveCameraWorld<T extends THREE.Camera>(camera: T): T {
  camera.updateWorldMatrix(true, false);
  return camera;
}

/**
 * Copies the host camera into the engine camera, ancestors resolved. The POSE comes from
 * the host, the PROJECTION does not: the engine composes it from the declared optics
 * (field, aspect, near plane, zoom) in its own depth convention — reversed, infinite far
 * plane — because the host matrix carries its library's and a finite far plane. `camera.far`
 * is still read as-is for what still depends on it (adaptive threshold, shadow range) and
 * for the frustum far plane, which keeps it; it no longer enters any depth. `updateCameraFrame`
 * then rebuilds the view by inverting the world matrix, the view-projection and the six
 * frustum planes, once for the whole frame.
 */
export function readCameraWorld(into: EngineCamera, camera: HostCamera): EngineCamera {
  resolveCameraWorld(camera);
  copyElements(into.world, camera.matrixWorld.elements);
  into.near = camera.near;
  into.far = camera.far;
  into.fov = camera.fov;
  into.aspect = camera.aspect;
  perspectiveProjection(into.projection, camera.fov, camera.aspect, camera.near, camera.zoom);
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
/** Engine camera a fresh host camera yields: the fallback of oracles the host calls
 *  before the first frame, where the engine has not yet copied any camera. */
export function defaultEngineCamera() {
  return (defaultEngine ??= readCameraWorld(createEngineCamera(), new THREE.PerspectiveCamera()));
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

/**
 * Copies `camera` into `into`, a parentless HOST camera that keeps its world pose bit for
 * bit: its local matrix is the source world matrix and is no longer recomposed from a local
 * position. A view rendered aside — second capture view — thus describes the view actually
 * drawn, even when the source is the child of a rig; for a parentless camera, nothing changes.
 * The source must be current, ancestors included.
 */
export function holdHostCamera(into: HostCamera, camera: HostCamera): HostCamera {
  into.copy(camera, false);
  into.matrixAutoUpdate = false;
  into.matrix.copy(camera.matrixWorld);
  into.matrixWorld.copy(into.matrix);
  into.matrixWorldInverse.copy(into.matrixWorld).invert();
  return into;
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
