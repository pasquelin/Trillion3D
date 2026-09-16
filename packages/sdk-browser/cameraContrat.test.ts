// Les frontières du contrat de pose caméra (`cameraWorld.ts`), pas les fonctions prises une à une.
//
// Trois frontières, et rien d'autre : ce qu'une entrée d'image résout, ce que la porte d'image en
// déduit pour tenir ou rejouer, et ce qu'une fonction appelée seule doit faire elle-même. Chaque
// test échoue si le contrat est rompu : le rig d'hôte est déplacé ET tourné, et jamais remonté par
// personne — c'est le seul cas où lire la pose locale d'une caméra passe encore pour juste.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  cameraPose,
  cameraWorldPosition,
  holdCameraWorld,
  resolveCameraWorld,
} from './cameraWorld.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { resolvePixelError } from './pageSelectionRequests.ts';
import { sameHizView } from './hizTemporal.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from './bench/justesse/cameraRig.mjs';

type Pose = (typeof POSES_PARENT)[number];
type Rig = { parent: THREE.Object3D; camera: THREE.PerspectiveCamera };
const VIEWPORT: [number, number] = [1280, 720];
/** Déplacé de +5 en X ET tourné de 0,6 rad : ni la translation ni la rotation ne se devinent. */
const DEPLACE_ET_TOURNE = POSES_PARENT[2] as Pose;

/** Une caméra sous un rig que l'hôte ne remonte pas, et sa jumelle sans parent de même pose monde. */
function sousRig(pose: Pose) {
  const rig = creeRig() as Rig;
  return {
    rig,
    camera: poseRig(rig, pose, false) as THREE.PerspectiveCamera,
    aplatie: cameraAplatie(pose) as THREE.PerspectiveCamera,
  };
}

test('contrat : la pose résolue sous un parent déplacé et tourné est la pose monde', () => {
  const { camera, aplatie } = sousRig(DEPLACE_ET_TOURNE);
  resolveCameraWorld(camera);
  assert.deepEqual(
    [...camera.matrixWorld.elements],
    [...aplatie.matrixWorld.elements],
    'la matrice monde résolue doit être celle de la caméra aplatie, au bit près',
  );
  assert.deepEqual(
    cameraWorldPosition(camera).toArray(),
    cameraWorldPosition(aplatie).toArray(),
    'la position lue par le contrat doit être celle de l’œil dans le monde',
  );
  // Le test discrimine : la pose locale, elle, nomme un point qui n'existe pas dans le monde.
  assert.notDeepEqual(camera.position.toArray(), cameraWorldPosition(aplatie).toArray());
});

test('contrat : la pose publiée est la pose monde, jamais la pose locale', () => {
  const { camera, aplatie } = sousRig(DEPLACE_ET_TOURNE);
  assert.deepEqual(cameraPose(camera), cameraPose(aplatie));
  assert.notDeepEqual(cameraPose(camera).position, camera.position.toArray());
});

test('frontière : la porte d’image tenue voit bouger un rig que l’hôte n’a pas remonté', () => {
  const gate = createWebglFrameGate();
  const source = new THREE.Object3D();
  const rig = creeRig() as Rig;
  const viewport: [number, number] = [800, 600];
  /** Une image d'un moteur rendu par Three, réduite à ce que la pose y décide. */
  const image = () => {
    resolveCameraWorld(rig.camera);
    gate.viewChanged(rig.camera, viewport, 1);
    gate.readScene(source, []);
    const tenue = gate.held();
    gate.keep(0, 0, [], 0, false);
    return tenue;
  };
  poseRig(rig, POSES_PARENT[0] as Pose, false);
  assert.equal(image(), false, 'la première image n’a rien à tenir');
  assert.equal(image(), false, 'une seule image identique ne prouve encore rien');
  assert.equal(image(), true, 'rien n’a bougé : l’image précédente EST celle-ci');
  // Le rig bouge SEUL : la caméra n'est pas touchée, son parent l'est, et personne ne le remonte.
  poseRig(rig, DEPLACE_ET_TOURNE, false);
  assert.equal(image(), false, 'la vue a bougé : l’image ne peut pas être tenue');
  assert.equal(image(), false, 'la nouvelle vue n’a pas encore d’image jumelle');
  assert.equal(image(), true, 'immobile à nouveau : l’image redevient tenable');
});

test('frontière : l’historique de vue gèle la pose monde, pas la pose locale', () => {
  const { rig, camera, aplatie } = sousRig(POSES_PARENT[1] as Pose);
  const gelee = holdCameraWorld(new THREE.PerspectiveCamera(), resolveCameraWorld(camera));
  assert.deepEqual([...gelee.matrixWorld.elements], [...aplatie.matrixWorld.elements]);
  assert.equal(sameHizView(gelee, camera), true, 'relu aussitôt, l’historique décrit cette vue-ci');
  poseRig(rig, DEPLACE_ET_TOURNE, false);
  assert.equal(
    sameHizView(gelee, camera),
    false,
    'un rig qui bouge seul périme l’historique : la pose locale, elle, n’a pas changé',
  );
});

/** Une lecture d'uniformes recopiée aussitôt : le tampon de travail est partagé entre deux appels. */
const uniformes = (camera: THREE.PerspectiveCamera) => {
  const u = cameraSelectionUniforms(camera, 1, VIEWPORT);
  return { view: [...u.view], planes: [...u.planes], cameraWorld: [...u.cameraWorld] };
};

test('frontière : une fonction appelée seule résout sa propre pose', () => {
  for (const pose of POSES_PARENT as Pose[]) {
    const { camera, aplatie } = sousRig(pose);
    assert.deepEqual(
      uniformes(camera),
      uniformes(aplatie),
      'les uniformes de sélection doivent décrire la même caméra que la pose aplatie',
    );
  }
});

test('frontière : le seuil adaptatif appelé seul mesure la vitesse de l’œil dans le monde', () => {
  const contexte = { pixelError: 1, lodAdaptive: true };
  const rig = creeRig() as Rig,
    sousRigMotion: { last?: THREE.Vector3; lastMs?: number } = {},
    aplatieMotion: { last?: THREE.Vector3; lastMs?: number } = {};
  for (const pose of POSES_PARENT as Pose[]) {
    // Aucune entrée d'image ici : la caméra du rig n'a jamais été remontée par qui que ce soit.
    resolvePixelError(
      contexte,
      poseRig(rig, pose, false) as THREE.PerspectiveCamera,
      sousRigMotion,
    );
    resolvePixelError(contexte, cameraAplatie(pose) as THREE.PerspectiveCamera, aplatieMotion);
    assert.deepEqual(
      sousRigMotion.last?.toArray(),
      aplatieMotion.last?.toArray(),
      'la position retenue pour la vitesse doit être celle de l’œil dans le monde',
    );
  }
  // Le test discrimine : sans résolution, la vitesse serait celle de la caméra dans son rig.
  assert.notDeepEqual(sousRigMotion.last?.toArray(), rig.camera.position.toArray());
});
