// Le rig d'hôte des reproductions « caméra parentée » : une caméra enfant d'un groupe qui n'appartient
// à aucune scène préparée. Le moteur ne met à jour que sa scène ; ce parent-là, seul l'hôte le touche.
import * as THREE from 'three';

/**
 * Poses du parent image après image : immobile, déplacé de +5 en X, puis tourné, puis ailleurs ; la
 * cinquième sort la scène du champ, la sixième approche la caméra sous le seuil d'un LOD.
 */
export const POSES_PARENT = [
  { x: 0, z: 0, ry: 0 },
  { x: 5, z: 0, ry: 0 },
  { x: 5, z: 0, ry: 0.6 },
  { x: -2.5, z: 0, ry: -0.9 },
  { x: 12, z: 0, ry: 0 },
  { x: 0, z: -3.5, ry: 0.1 },
];

/** Poses d'une caméra sans parent, pour l'empreinte avant/après : position locale et lacet. */
export const POSES_SANS_PARENT = Array.from({ length: 24 }, (_, i) => ({
  x: Math.sin(i * 0.7) * 3,
  y: Math.cos(i * 1.3) * 0.8,
  z: 4 + ((i * 37) % 11) * 0.35,
  ry: Math.sin(i * 0.45) * 0.5,
  rx: Math.cos(i * 0.9) * 0.2,
}));

const regle = (camera, fov, aspect) => {
  camera.fov = fov;
  camera.aspect = aspect;
  camera.near = 0.1;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  return camera;
};

/** La caméra est posée localement, jamais regardée vers un point : aucune lecture du parent. */
export function creeRig(fov = 55, aspect = 16 / 9) {
  const parent = new THREE.Group();
  const camera = regle(new THREE.PerspectiveCamera(), fov, aspect);
  camera.position.set(0.3, 0.2, 5);
  camera.rotation.set(-0.02, 0.04, 0);
  parent.add(camera);
  return { parent, camera };
}

/** Pose le parent. `hote` : l'hôte met aussi à jour son rig avant l'image, comme il le devrait. */
export function poseRig(rig, pose, hote) {
  rig.parent.position.set(pose.x, 0, pose.z);
  rig.parent.rotation.y = pose.ry;
  if (hote) rig.parent.updateMatrixWorld(true);
  return rig.camera;
}

/**
 * Caméra sans parent de même pose monde que le rig mis à jour par l'hôte, au bit près : sa matrice
 * locale est la matrice monde du rig (plus de recomposition depuis un quaternion), sa position est
 * la translation de cette matrice. Vue, inverse, direction et position sont donc exactement celles
 * qu'un rig juste doit produire.
 */
export function cameraAplatie(pose, fov = 55, aspect = 16 / 9) {
  const jumeau = creeRig(fov, aspect);
  poseRig(jumeau, pose, true);
  const plate = regle(new THREE.PerspectiveCamera(), fov, aspect);
  jumeau.camera.matrixWorld.decompose(plate.position, plate.quaternion, plate.scale);
  plate.position.setFromMatrixPosition(jumeau.camera.matrixWorld);
  plate.matrixAutoUpdate = false;
  plate.matrix.copy(jumeau.camera.matrixWorld);
  plate.updateMatrixWorld(true);
  return plate;
}

/** Caméra sans parent posée directement. */
export function cameraSansParent(pose, fov = 55, aspect = 16 / 9) {
  const camera = regle(new THREE.PerspectiveCamera(), fov, aspect);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.rotation.set(pose.rx, pose.ry, 0);
  camera.updateMatrixWorld();
  return camera;
}
