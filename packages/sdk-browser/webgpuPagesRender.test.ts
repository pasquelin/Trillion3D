// A10 : `renderWebgpuPages` recopie la pose de la caméra de comparaison Hi-Z (`run.previousHizView`)
// dans la même instance gardée au lieu d'un `camera.clone()` par changement de vue. `sameHizView` ne
// lit que la matrice monde inverse et la matrice de projection, donc recopier la pose dans une
// caméra déjà allouée doit rendre exactement le même verdict, image après image, qu'un nouveau clone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sameHizView } from './hiz.ts';

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

test('copying a pose into a kept camera matches cloning a fresh one, verdict for verdict', () => {
  const frames = poses(50);
  let clonedPrevious: THREE.PerspectiveCamera | undefined;
  let keptPrevious: THREE.PerspectiveCamera | undefined;
  for (const frame of frames) {
    const viaClone = sameHizView(clonedPrevious, frame);
    clonedPrevious = frame.clone();
    const viaCopy = sameHizView(keptPrevious, frame);
    keptPrevious = (keptPrevious ?? new THREE.PerspectiveCamera()).copy(frame, false);
    assert.equal(viaCopy, viaClone, 'same-image verdict must not depend on clone vs. copy');
  }
});

test('the kept camera is the same object across frames: never reallocated, never left undefined', () => {
  const frames = poses(3);
  let kept: THREE.PerspectiveCamera | undefined;
  const identities = new Set<THREE.PerspectiveCamera>();
  for (const frame of frames) {
    sameHizView(kept, frame);
    kept = (kept ?? new THREE.PerspectiveCamera()).copy(frame, false);
    identities.add(kept);
  }
  assert.equal(identities.size, 1, 'the same camera instance is reused across every frame');
});

test('a repeated identical pose is stable, and NaN in the world matrix never reports a false match', () => {
  const a = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  a.position.z = 5;
  a.lookAt(0, 0, 0);
  a.updateMatrixWorld();
  const kept = new THREE.PerspectiveCamera().copy(a, false);
  assert.equal(sameHizView(kept, a), true);
  // `sameHizView` calls `updateMatrixWorld()` on both cameras, which recomputes the world-inverse
  // matrix from position/quaternion/scale: a NaN has to enter through those, not through poking the
  // matrix elements directly, or it would just be overwritten before the comparison runs.
  const nanCam = a.clone();
  nanCam.position.x = NaN;
  assert.equal(sameHizView(kept, nanCam), false, 'NaN never compares equal to itself');
});
