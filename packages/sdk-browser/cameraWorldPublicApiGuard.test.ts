// WHAT THESE TWO PUBLIC APIS EXPECT, AND WHAT THEY REFUSE.
//
// BEFORE (develop, fe285470): `cameraSelectionUniforms(camera: THREE.PerspectiveCamera, …)` and
// `rasterVisibility(pages, camera: THREE.PerspectiveCamera, viewport)`.
// AFTER (M3b): `cameraSelectionUniforms(cam: EngineCamera, …)` (gpuSelection.ts) and
// `rasterVisibility(pages, cam: EngineCamera, viewport)` (visibilityRaster.ts) — both read
// `cam.planes`/`cam.view`/`cam.viewProjection`, absent from a raw host camera.
//
// THE CHOICE, AND IT IS FINAL: these APIs take the ENGINE camera and reject a raw host camera
// outright. They do not convert at the boundary: converting would put `readCameraWorld` —
// a matrix invert and six planes — back into a function the cut calls every frame, and would
// hide the unwalked rig the contract exists to catch. A host therefore enters through
// `cameraMoteur(…)`, as frame entry does.
//
// `test:gpu` had failed on four hosts of `test/*.browser.ts` that stayed on the raw camera;
// they moved to `cameraMoteur` (in-repo fixtures, not third-party hosts). `pnpm test` had not
// seen it: they are scripts outside `pnpm test`, that only `pnpm run test:gpu` runs —
// these tests therefore reproduce both calls without a browser, the faulty one and the right one.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { rasterVisibility } from './visibilityRaster.ts';
import type { VisPage } from './visibilityTypes.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from '../../test/justesse/cameraRig.ts';
import { cameraMoteur } from './cameraFixture.ts';

type Pose = (typeof POSES_PARENT)[number];
const POSE = POSES_PARENT[2] as Pose; // moved AND rotated: neither translation nor rotation can be guessed.

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

test('cameraSelectionUniforms rejects the raw host camera: it does not convert at the boundary', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera;
  // `camera` has neither `.planes` nor `.view` nor `.viewProjection`: what `test:gpu` found on
  // a real GPU is already visible here, without GPU or browser.
  assert.throws(
    () =>
      cameraSelectionUniforms(
        camera as unknown as Parameters<typeof cameraSelectionUniforms>[0],
        0,
        [1000, 1000],
      ),
    TypeError,
    'expected: outright reject (TypeError) for lack of `cam.planes` — if this passes: silent wrong uniforms',
  );
});

test('rasterVisibility rejects the raw host camera: it does not convert at the boundary', () => {
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
    'expected: outright reject (TypeError) for lack of `cam.viewProjection` — if this passes: silent wrong buffer',
  );
});

test('cameraSelectionUniforms(cameraMoteur(…)): the correct call under a rig throws nothing and follows the flattened pose', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera,
    aplatie = cameraAplatie(POSE) as THREE.PerspectiveCamera;
  const sousRig = cameraSelectionUniforms(cameraMoteur(camera), 0, [1000, 1000]);
  const attendu = cameraSelectionUniforms(cameraMoteur(aplatie), 0, [1000, 1000]);
  assert.deepEqual([...sousRig.planes], [...attendu.planes], 'frustum planes');
  assert.deepEqual([...sousRig.view], [...attendu.view], 'view');
  assert.deepEqual(sousRig.cameraWorld, attendu.cameraWorld, 'eye world position');
});

test('rasterVisibility(cameraMoteur(…)): the correct call under a rig throws nothing and yields the same image', () => {
  const rig = creeRig(),
    camera = poseRig(rig, POSE, true) as THREE.PerspectiveCamera,
    aplatie = cameraAplatie(POSE) as THREE.PerspectiveCamera,
    matrix = new THREE.Matrix4();
  const sousRig = rasterVisibility([pageTriangle(matrix)], cameraMoteur(camera), [64, 64]);
  const attendu = rasterVisibility([pageTriangle(matrix)], cameraMoteur(aplatie), [64, 64]);
  assert.deepEqual([...sousRig.ids], [...attendu.ids], 'the visibility buffer must be identical');
});
