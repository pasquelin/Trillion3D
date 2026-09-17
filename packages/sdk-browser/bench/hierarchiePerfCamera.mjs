// Charges caméra du banc de performance du lot M3a : une caméra racine qui tourne autour de la scène,
// des deux côtés, avec les lignes et la vérification de `hierarchiePerf.mjs`.
import * as THREE from 'three';
import {
  addTransformNode,
  createCameraFrame,
  createTransformTree,
  lookAtNode,
  perspectiveProjection,
  setNodePosition,
  updateCameraFrame,
  updateNodeMatrixWorld,
} from '../../sdk-core/index.ts';
import { ligne, memes } from './hierarchiePerf.mjs';

/** Une caméra racine qui tourne autour de la scène : projection, vue, vue-projection et plans par image. */
export function* groupesCamera() {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000),
    vp = new THREE.Matrix4(),
    tronc = new THREE.Frustum();
  const tree = createTransformTree(1),
    noeud = addTransformNode(tree),
    projection = new Float64Array(16),
    image = createCameraFrame(),
    haut = Float64Array.from(camera.up.toArray());
  const c = { camera, tree };
  const poseThree = (tour) => camera.position.set(Math.cos(tour) * 200, 40, Math.sin(tour) * 200);
  const poseNous = (tour) =>
    setNodePosition(tree, noeud, Math.cos(tour) * 200, 40, Math.sin(tour) * 200);
  const verifie = () =>
    Number.isFinite(projection[0]) &&
    Number.isFinite(image.viewProjection[0]) &&
    Number.isFinite(image.planes[0]);
  yield [
    ligne(
      'caméra',
      'image : projection, vue, vue-projection, plans',
      1,
      1,
      c,
      (_, tour) => {
        poseThree(tour);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        tronc.setFromProjectionMatrix(vp);
      },
      (_, tour) => {
        poseNous(tour);
        perspectiveProjection(projection, 60, 16 / 9, 0.1, 1);
        updateNodeMatrixWorld(tree, noeud);
        updateCameraFrame(image, projection, tree.worldViews[noeud]);
      },
      verifie,
    ),
    ligne(
      'caméra',
      'lookAt puis image',
      1,
      1,
      c,
      (_, tour) => {
        poseThree(tour);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        tronc.setFromProjectionMatrix(vp);
      },
      (_, tour) => {
        poseNous(tour);
        lookAtNode(tree, noeud, 0, 0, 0, haut, true);
        updateNodeMatrixWorld(tree, noeud);
        updateCameraFrame(image, projection, tree.worldViews[noeud]);
      },
      verifie,
    ),
  ];
}
