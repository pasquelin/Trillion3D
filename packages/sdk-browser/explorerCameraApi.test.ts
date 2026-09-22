// The view a measurement campaign saved comes back on the live camera: a host camera is its
// local pose and its declared optics, so putting those back rebuilds every matrix derived
// from them — the campaign leaves the session exactly where it found it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerCameraApi } from './explorerCameraApi.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';

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
    options: {} as ExplorerOptions,
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
