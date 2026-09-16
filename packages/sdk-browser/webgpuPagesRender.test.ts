// A10 : `renderWebgpuPages` recopie la vue de comparaison Hi-Z (`run.previousHizView`) dans la même
// caméra du moteur gardée au lieu d'en allouer une par changement de vue. `sameHizView` ne lit que
// la vue et la projection, donc recopier dans une structure déjà allouée doit rendre exactement le
// même verdict, image après image, qu'une structure neuve.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sameHizView } from './hiz.ts';
import { invalidateOccluderHistory, invalidateTemporalPyramid } from './webgpuPagesDrops.ts';
import {
  createEngineCamera,
  holdCameraWorld,
  readCameraWorld,
  type EngineCamera,
} from './cameraWorld.ts';
import { cameraMoteur } from './cameraFixture.ts';

function poses(n: number) {
  const cams: THREE.PerspectiveCamera[] = [];
  for (let i = 0; i < n; i++) {
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
    cam.position.set(Math.sin(i * 0.7) * 3, 0, 6 + i * 0.001);
    if (i % 5 === 0) cam.fov = 40 + i; // occasional projection change
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cams.push(cam);
  }
  return cams;
}

test('copying a view into a kept engine camera matches a fresh one, verdict for verdict', () => {
  const frames = poses(50);
  let neuve: EngineCamera | undefined;
  let gardee: EngineCamera | undefined;
  for (const frame of frames) {
    const courante = cameraMoteur(frame);
    const viaNeuve = sameHizView(neuve, courante);
    neuve = holdCameraWorld(createEngineCamera(), courante);
    const viaCopie = sameHizView(gardee, courante);
    gardee = holdCameraWorld(gardee ?? createEngineCamera(), courante);
    assert.equal(viaCopie, viaNeuve, 'same-image verdict must not depend on a fresh structure');
  }
});

test('the kept camera is the same object across frames: never reallocated, never left undefined', () => {
  const frames = poses(3);
  let kept: EngineCamera | undefined;
  const identities = new Set<EngineCamera>();
  for (const frame of frames) {
    const courante = cameraMoteur(frame);
    sameHizView(kept, courante);
    kept = holdCameraWorld(kept ?? createEngineCamera(), courante);
    identities.add(kept);
  }
  assert.equal(identities.size, 1, 'the same camera instance is reused across every frame');
});

test('a repeated identical pose is stable, and NaN in the world matrix never reports a false match', () => {
  const a = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  a.position.z = 5;
  a.lookAt(0, 0, 0);
  a.updateMatrixWorld();
  const kept = holdCameraWorld(createEngineCamera(), cameraMoteur(a));
  assert.equal(sameHizView(kept, cameraMoteur(a)), true);
  // La caméra gardée est figée ; celle de CETTE image est recopiée depuis l'hôte, ce qui inverse sa
  // matrice monde : un NaN doit entrer par la pose locale, pas en touchant les nombres à la main,
  // sinon il serait réécrit avant la comparaison.
  const nanCam = a.clone();
  nanCam.position.x = NaN;
  assert.equal(
    sameHizView(kept, readCameraWorld(createEngineCamera(), nanCam)),
    false,
    'NaN never compares equal to itself',
  );
});

// Levier « historique d'occulteurs » : une caméra qui bouge ne périme que la pyramide temporelle.
// Les deux invalidations sont de nature différente — la pyramide n'est relue que pour une vue
// identique au bit près, l'historique des occulteurs ne nomme que des pages — et se séparent donc.
function runState() {
  return {
    noOccluderHistory: false,
    temporalHizState: { pyramid: {}, camera: {} },
  } as unknown as Parameters<typeof invalidateTemporalPyramid>[0];
}

test('invalidateTemporalPyramid drops the pyramid and keeps the occluder history', () => {
  const run = runState();
  invalidateTemporalPyramid(run);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
  assert.equal(run.noOccluderHistory, false, 'the pages drawn last image still describe this one');
});

test('invalidateOccluderHistory still drops both', () => {
  const run = runState();
  invalidateOccluderHistory(run);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
  assert.equal(run.noOccluderHistory, true);
});
