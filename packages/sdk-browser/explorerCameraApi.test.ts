// The view a measurement campaign saved comes back on the live camera: a host camera is its
// local pose, the local matrix that is the pose's other face, and its declared optics, so
// putting those back rebuilds every matrix derived from them — the campaign leaves the session
// exactly where it found it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerCameraApi } from './explorerCameraApi.ts';
import type { MeasuredWorldOptions, RenderBackend } from './backendTypes.ts';

test('restoreAfterCampaign puts the saved pose and optics back on the live camera', () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
  camera.position.set(1, 2, 3);
  camera.lookAt(new THREE.Vector3(-4, 0, 6));
  camera.updateMatrixWorld();
  const saved = camera.clone();
  // The campaign moves the camera and changes its optics, then hands the saved view back.
  camera.position.set(-9, 4, 12);
  camera.quaternion.set(0, 0, 0, 1);
  Object.assign(camera, { fov: 22, aspect: 2, near: 5, far: 50, zoom: 3 });
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const api = createExplorerCameraApi({
    check: () => {},
    options: {} as MeasuredWorldOptions,
    camera,
    center: new THREE.Vector3(-4, 0, 6),
    homeOffset: new THREE.Vector3(0, 0, 1),
    lookAtTarget: new THREE.Vector3(),
    radius: 1,
    canvas: { width: 8, height: 8 } as HTMLCanvasElement,
    backends: [{ id: 'webgpu-page-raster' } as RenderBackend],
    disposed: () => false,
    setMeasuring: () => {},
    setActive: () => {},
    hostedControls: [],
  });
  api.restoreAfterCampaign('webgpu-page-raster', saved);
  assert.deepEqual(camera.position.toArray(), saved.position.toArray());
  assert.deepEqual(camera.quaternion.toArray(), saved.quaternion.toArray());
  assert.deepEqual(
    [camera.fov, camera.aspect, camera.near, camera.far, camera.zoom],
    [50, 1.5, 0.1, 100, 1],
  );
  assert.deepEqual([...camera.projectionMatrix.elements], [...saved.projectionMatrix.elements]);
  assert.deepEqual([...camera.matrixWorld.elements], [...saved.matrixWorld.elements]);
});

test('restoreAfterCampaign restores a camera the host posed by matrix', () => {
  // A host that writes `matrix` itself keeps `matrixAutoUpdate` false, and `updateMatrixWorld`
  // then recomposes nothing from the local fields: restoring those alone would leave the camera
  // wherever the campaign parked it.
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
  camera.matrixAutoUpdate = false;
  camera.matrix.makeTranslation(3, -1, 7);
  camera.updateMatrixWorld();
  const saved = camera.clone();
  camera.matrix.makeTranslation(-20, 40, 0);
  camera.updateMatrixWorld();
  const api = createExplorerCameraApi({
    check: () => {},
    options: {} as MeasuredWorldOptions,
    camera,
    center: new THREE.Vector3(),
    homeOffset: new THREE.Vector3(0, 0, 1),
    lookAtTarget: new THREE.Vector3(),
    radius: 1,
    canvas: { width: 8, height: 8 } as HTMLCanvasElement,
    backends: [{ id: 'webgpu-page-raster' } as RenderBackend],
    disposed: () => false,
    setMeasuring: () => {},
    setActive: () => {},
    hostedControls: [],
  });
  api.restoreAfterCampaign('webgpu-page-raster', saved);
  assert.equal(camera.matrixAutoUpdate, false);
  assert.deepEqual([...camera.matrix.elements], [...saved.matrix.elements]);
  // And the world pose follows the matrix that was put back. Asserting it against
  // `saved.matrixWorld` would prove nothing: a host that poses by matrix raises no update flag,
  // so both sides sit at the identity the clone was taken with. The restore has to compose it.
  assert.deepEqual([...camera.matrixWorld.elements], [...camera.matrix.elements]);
  assert.deepEqual([camera.matrixWorld.elements[12], camera.matrixWorld.elements[14]], [3, 7]);
});
