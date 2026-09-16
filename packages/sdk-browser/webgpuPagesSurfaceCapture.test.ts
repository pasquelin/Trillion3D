// `captureSurfaceView` (lot 3) : le `cameraWorld` publié est celui de la caméra du moteur que le
// contrat vient de recopier (`rt.run.gate.cam.eye`), jamais une lecture directe de la caméra hôte.
// Sous un rig que l'hôte ne remonte pas, les deux poses diffèrent : seule la pose monde discrimine.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('captureSurfaceView : cameraWorld est la pose monde sous un rig, pas la pose locale de la caméra hôte', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const fixture = quadScene();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    const main = camera();
    backend.render(main);
    await backend.flush?.();
    backend.render(main);
    await backend.flush?.();

    // Rig à deux niveaux, que personne d'autre que ce test ne remonte : la caméra locale garde une
    // pose triviale, et c'est le rig seul qui porte la translation et la rotation.
    const rig = new THREE.Object3D();
    rig.position.set(4, -2, 6);
    rig.rotation.set(0, Math.PI / 3, 0);
    const view = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    view.position.set(0, 0, 0);
    rig.add(view);
    rig.updateWorldMatrix(true, false);
    const attendu = view.getWorldPosition(new THREE.Vector3()).toArray();
    // Témoin : la pose locale de la caméra (l'origine) n'est pas la pose monde sous ce rig.
    assert.notDeepEqual(attendu, view.position.toArray());

    const surface = await backend.captureSurfaceView!(view, { width: 16, height: 16 });
    assert.deepEqual(surface.cameraWorld, attendu);
    surface.dispose();
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
