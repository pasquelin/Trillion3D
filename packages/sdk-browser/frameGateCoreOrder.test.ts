// `frameGateCore.ts` garantit un ORDRE : `enterFrame` recopie la pose caméra (`readCameraWorld`)
// AVANT le seuil adaptatif et AVANT l'empreinte de vue. `cameraContrat.test.ts` le prouve en
// appelant `resolveCameraWorld` puis `viewChanged`/`readScene` à la main — jamais `enterFrame`
// lui-même. Ces tests bouclent sur l'entrée publique complète, pour que l'ordre soit celui que
// `enterFrame` applique réellement, pas celui qu'un test recompose.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFrameGateCore } from './frameGateCore.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';
import type { CameraMotion } from './cameraWorld.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from './bench/justesse/cameraRig.mjs';

type Pose = (typeof POSES_PARENT)[number];
type Rig = { parent: THREE.Object3D; camera: THREE.PerspectiveCamera };
const VIEWPORT: [number, number] = [800, 600];
const DEPLACE_ET_TOURNE = POSES_PARENT[2] as Pose;

test('enterFrame recopie la pose avant l’empreinte de vue : un rig déplacé seul, jamais remonté par l’hôte, rejoue l’image', () => {
  const gate = createWebglFrameGate();
  const source = new THREE.Object3D();
  const rig = creeRig() as Rig;
  const motion: CameraMotion = {};
  const image = () => {
    // `hote = false` : personne ne remonte le rig, comme le contrat l'annonce pour un parent hors
    // scène préparée. Si `enterFrame` lisait la pose locale, ou la résolvait APRÈS l'empreinte de
    // vue, ce déplacement n'y changerait rien et l'image resterait tenue à tort.
    const held = gate.enterFrame({}, rig.camera, motion, VIEWPORT, source, []);
    gate.keep(0, 0, [], 0, false);
    return held;
  };
  poseRig(rig, POSES_PARENT[0] as Pose, false);
  assert.equal(image(), false, 'la première image n’a rien à tenir');
  assert.equal(image(), false, 'une seule image identique ne prouve encore rien');
  assert.equal(image(), true, 'rien n’a bougé : l’image précédente EST celle-ci');
  poseRig(rig, DEPLACE_ET_TOURNE, false);
  assert.equal(image(), false, 'le rig a bougé seul : l’image ne peut pas être tenue');
  assert.equal(image(), false, 'la nouvelle vue n’a pas encore d’image jumelle');
  assert.equal(image(), true, 'immobile à nouveau : l’image redevient tenable');
});

test('enterFrame résout la pose avant le seuil adaptatif : la vitesse mesurée est celle de l’œil monde', () => {
  const gate = createFrameGateCore(1);
  const source = new THREE.Object3D();
  const rig = creeRig() as Rig;
  const motion: CameraMotion = {};
  poseRig(rig, DEPLACE_ET_TOURNE, false); // jamais remonté : seule `enterFrame` peut le voir.
  gate.enterFrame({ pixelError: 1, lodAdaptive: true }, rig.camera, motion, VIEWPORT, source, []);
  const eyeAplatie = [...cameraMoteur(cameraAplatie(DEPLACE_ET_TOURNE)).eye];
  assert.deepEqual(
    [...(motion.last ?? [])],
    eyeAplatie,
    'la vitesse doit partir de la position de l’œil dans le monde, ancêtres compris',
  );
  assert.notDeepEqual(
    [...(motion.last ?? [])],
    rig.camera.position.toArray(),
    'témoin : sans résolution préalable, ce serait la pose locale sous le rig',
  );
});
