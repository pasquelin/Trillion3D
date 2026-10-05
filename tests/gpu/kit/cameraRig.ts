// Host rig of the "parented camera" reproductions: a camera child of a group that belongs to no
// prepared scene. The engine only updates its scene; that parent, only the host touches.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';

/**
 * Parent poses frame after frame: still, moved +5 in X, then rotated, then elsewhere; the fifth
 * takes the scene out of view, the sixth brings the camera under a LOD threshold.
 */
export const POSES_PARENT = [
  { x: 0, z: 0, ry: 0 },
  { x: 5, z: 0, ry: 0 },
  { x: 5, z: 0, ry: 0.6 },
  { x: -2.5, z: 0, ry: -0.9 },
  { x: 12, z: 0, ry: 0 },
  { x: 0, z: -3.5, ry: 0.1 },
];

/** A pose of the parented rig: `poseRig` only ever reads these three fields. */
export type PoseParent = { x: number; z: number; ry: number };
export type Rig = { parent: G.Group; camera: G.Camera };

const configure = (camera: G.Camera, fov: number, aspect: number): G.Camera => {
  camera.fov = fov;
  camera.aspect = aspect;
  camera.near = 0.1;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  return camera;
};

/** The camera is posed locally, never looked at a point: no parent is read. */
export function creeRig(fov = 55, aspect = 16 / 9): Rig {
  const parent = new G.Group();
  const camera = configure(G.perspectiveCamera(), fov, aspect);
  camera.position.set(0.3, 0.2, 5);
  camera.rotation.set(-0.02, 0.04, 0);
  parent.add(camera);
  return { parent, camera };
}

/** Poses the parent. `host`: the host also updates its rig before the frame, as it should. */
export function poseRig(rig: Rig, pose: PoseParent, host: boolean): G.Camera {
  rig.parent.position.set(pose.x, 0, pose.z);
  rig.parent.rotation.y = pose.ry;
  if (host) rig.parent.updateMatrixWorld(true);
  return rig.camera;
}

/**
 * Parentless camera of the same world pose as the host-updated rig, bit for bit: its local matrix
 * is the rig's world matrix (no recomposition from a quaternion), its position is that matrix's
 * translation. View, inverse, direction and position are therefore exactly those a correct rig
 * must produce. `plate`: the camera to pose, kept from frame to frame like the rig's own: the
 * engine reads a different camera object with a different view as a cut (`trackViewCamera`).
 */
export function flattenedCamera(
  pose: PoseParent,
  fov = 55,
  aspect = 16 / 9,
  plate = configure(G.perspectiveCamera(), fov, aspect),
): G.Camera {
  const twin = creeRig(fov, aspect);
  poseRig(twin, pose, true);
  twin.camera.matrixWorld.decompose(plate.position, plate.quaternion, plate.scale);
  plate.position.copy(new G.Vector3().setFromMatrixPosition(twin.camera.matrixWorld));
  plate.matrixAutoUpdate = false;
  plate.matrix.copy(twin.camera.matrixWorld);
  plate.updateMatrixWorld(true);
  return plate;
}

/** A point in normalised device coordinates: seen from `camera`, then projected by it. */
export const project = (point: G.Vector3, camera: G.Camera) =>
  point.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
