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

/** Poses of a parentless camera, for the before/after fingerprint: local position and yaw. */
export const POSES_SANS_PARENT = Array.from({ length: 24 }, (_, i) => ({
  x: Math.sin(i * 0.7) * 3,
  y: Math.cos(i * 1.3) * 0.8,
  z: 4 + ((i * 37) % 11) * 0.35,
  ry: Math.sin(i * 0.45) * 0.5,
  rx: Math.cos(i * 0.9) * 0.2,
}));

/** A pose of the parented rig: `poseRig` only ever reads these three fields. */
export type PoseParent = { x: number; z: number; ry: number };
/** A pose of a parentless camera, posed directly: local position and yaw/pitch. */
export type PoseLibre = { x: number; y: number; z: number; ry: number; rx: number };
export type Rig = { parent: G.GraphGroup; camera: G.GraphCamera };

const regle = (camera: G.GraphCamera, fov: number, aspect: number): G.GraphCamera => {
  camera.fov = fov;
  camera.aspect = aspect;
  camera.near = 0.1;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  return camera;
};

/** The camera is posed locally, never looked at a point: no parent is read. */
export function creeRig(fov = 55, aspect = 16 / 9): Rig {
  const parent = new G.GraphGroup();
  const camera = regle(G.perspectiveCamera(), fov, aspect);
  camera.position.set(0.3, 0.2, 5);
  camera.rotation.set(-0.02, 0.04, 0);
  parent.add(camera);
  return { parent, camera };
}

/** Poses the parent. `hote`: the host also updates its rig before the frame, as it should. */
export function poseRig(rig: Rig, pose: PoseParent, hote: boolean): G.GraphCamera {
  rig.parent.position.set(pose.x, 0, pose.z);
  rig.parent.rotation.y = pose.ry;
  if (hote) rig.parent.updateMatrixWorld(true);
  return rig.camera;
}

/**
 * Parentless camera of the same world pose as the host-updated rig, bit for bit: its local matrix
 * is the rig's world matrix (no recomposition from a quaternion), its position is that matrix's
 * translation. View, inverse, direction and position are therefore exactly those a correct rig
 * must produce.
 */
export function cameraAplatie(pose: PoseParent, fov = 55, aspect = 16 / 9): G.GraphCamera {
  const jumeau = creeRig(fov, aspect);
  poseRig(jumeau, pose, true);
  const plate = regle(G.perspectiveCamera(), fov, aspect);
  jumeau.camera.matrixWorld.decompose(plate.position, plate.quaternion, plate.scale);
  plate.position.copy(new G.Vector3().setFromMatrixPosition(jumeau.camera.matrixWorld));
  plate.matrixAutoUpdate = false;
  plate.matrix.copy(jumeau.camera.matrixWorld);
  plate.updateMatrixWorld(true);
  return plate;
}

/** Parentless camera posed directly. */
export function cameraSansParent(pose: PoseLibre, fov = 55, aspect = 16 / 9): G.GraphCamera {
  const camera = regle(G.perspectiveCamera(), fov, aspect);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.rotation.set(pose.rx, pose.ry, 0);
  camera.updateMatrixWorld();
  return camera;
}
