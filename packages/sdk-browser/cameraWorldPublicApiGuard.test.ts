// CE QUE CES DEUX API PUBLIQUES ATTENDENT, ET CE QU'ELLES REFUSENT.
//
// AVANT (develop, fe285470) : `cameraSelectionUniforms(camera: THREE.PerspectiveCamera, …)` et
// `rasterVisibility(pages, camera: THREE.PerspectiveCamera, viewport)`.
// APRÈS (M3b) : `cameraSelectionUniforms(cam: EngineCamera, …)` (gpuSelection.ts) et
// `rasterVisibility(pages, cam: EngineCamera, viewport)` (visibilityRaster.ts) — les deux lisent
// `cam.planes`/`cam.view`/`cam.viewProjection`, absents d'une caméra hôte brute.
//
// LE CHOIX, ET IL EST DÉFINITIF : ces API prennent la caméra du MOTEUR et rejettent net une caméra
// hôte brute. Elles ne convertissent pas à la frontière : convertir remettrait `readCameraWorld` —
// une inversion de matrice et six plans — dans une fonction que la coupe appelle par image, et
// masquerait le rig non remonté que le contrat existe pour attraper. Un hôte entre donc par
// `cameraMoteur(…)`, comme l'entrée d'image le fait.
//
// `test:gpu` avait échoué sur quatre hôtes de `test/*.browser.mjs` restés sur la caméra brute ; ils
// sont passés à `cameraMoteur` (montages internes au dépôt, pas des hôtes tiers). `npm test` ne
// l'avait pas vu : ce sont des scripts hors de `npm test`, que seul `npm run test:gpu` exécute —
// ces tests-ci reproduisent donc les deux appels sans navigateur, le fautif et le bon.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { rasterVisibility } from './visibilityRaster.ts';
import type { VisPage } from './visibilityTypes.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from './bench/justesse/cameraRig.mjs';
import { cameraMoteur } from './cameraFixture.ts';

type Pose = (typeof POSES_PARENT)[number];
const POSE = POSES_PARENT[2] as Pose; // déplacé ET tourné : ni la translation ni la rotation ne se devinent.

function pageTriangle(matrix: THREE.Matrix4): VisPage {
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3),
  );
  return {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometrie.attributes,
    matrix,
    material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  };
}

test('cameraSelectionUniforms rejette la caméra hôte brute : elle ne convertit pas à la frontière', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera;
  // `camera` n'a ni `.planes` ni `.view` ni `.viewProjection` : ce que `test:gpu` a découvert sur
  // carte graphique réelle est déjà visible ici, sans GPU ni navigateur.
  assert.throws(
    () =>
      cameraSelectionUniforms(
        camera as unknown as Parameters<typeof cameraSelectionUniforms>[0],
        0,
        [1000, 1000],
      ),
    TypeError,
    'attendu : rejet net (TypeError) faute de `cam.planes` — obtenu si ça passe : uniformes faux et silencieux',
  );
});

test('rasterVisibility rejette la caméra hôte brute : elle ne convertit pas à la frontière', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera;
  assert.throws(
    () =>
      rasterVisibility(
        [pageTriangle(new THREE.Matrix4())],
        camera as unknown as Parameters<typeof rasterVisibility>[1],
        [64, 64],
      ),
    TypeError,
    'attendu : rejet net (TypeError) faute de `cam.viewProjection` — obtenu si ça passe : tampon faux et silencieux',
  );
});

test('cameraSelectionUniforms(cameraMoteur(…)) : l’appel correct sous un rig ne lève rien et suit la pose aplatie', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera,
    aplatie = cameraAplatie(POSE) as THREE.PerspectiveCamera;
  const sousRig = cameraSelectionUniforms(cameraMoteur(camera), 0, [1000, 1000]);
  const attendu = cameraSelectionUniforms(cameraMoteur(aplatie), 0, [1000, 1000]);
  assert.deepEqual([...sousRig.planes], [...attendu.planes], 'plans du tronc');
  assert.deepEqual([...sousRig.view], [...attendu.view], 'vue');
  assert.deepEqual(sousRig.cameraWorld, attendu.cameraWorld, 'position monde de l’œil');
});

test('rasterVisibility(cameraMoteur(…)) : l’appel correct sous un rig ne lève rien et rend la même image', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera,
    aplatie = cameraAplatie(POSE) as THREE.PerspectiveCamera,
    matrix = new THREE.Matrix4();
  const sousRig = rasterVisibility([pageTriangle(matrix)], cameraMoteur(camera), [64, 64]);
  const attendu = rasterVisibility([pageTriangle(matrix)], cameraMoteur(aplatie), [64, 64]);
  assert.deepEqual(
    [...sousRig.ids],
    [...attendu.ids],
    'le tampon de visibilité doit être identique',
  );
});
