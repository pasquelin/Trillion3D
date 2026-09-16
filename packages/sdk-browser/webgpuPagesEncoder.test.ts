// `submitColorCopy` (lot 3) : la trace `encoding-submit` publie `pose: enginePose(run.gate.cam)`,
// plus jamais `cameraPose(run.lastCamera)`. Sous un rig que l'hôte ne remonte pas, seule la pose
// monde de la caméra du moteur discrimine — la pose locale de la caméra hôte, elle, ne bouge pas.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('encoding-submit : la pose tracée est celle de la caméra du moteur, pas la pose locale de la caméra hôte', async () => {
  installGpuGlobals();
  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const fixture = quadScene();
  const { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    diagnosticDetail: 'trace' as never,
    onDiagnostic: (event) => events.push(event),
  } as never);
  try {
    await backend.prepare();
    // Rig que personne d'autre ne remonte : la caméra hôte locale reste à l'origine, seul le rig
    // porte la translation. La pose tracée doit suivre le rig, pas la pose locale de la caméra.
    const rig = new THREE.Object3D();
    rig.position.set(7, -1, 4);
    const hostCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    rig.add(hostCamera);
    rig.updateWorldMatrix(true, false);
    const attendu = hostCamera.getWorldPosition(new THREE.Vector3()).toArray();
    assert.notDeepEqual(
      attendu,
      hostCamera.position.toArray(),
      'témoin : le rig déplace bien l’œil',
    );

    backend.render(hostCamera);
    await backend.flush?.();

    const submissions = events.filter((event) => event.phase === 'encoding-submit');
    assert.ok(submissions.length > 0, 'au moins une soumission tracée');
    for (const event of submissions) {
      const pose = event.context.pose as { position: number[] } | null;
      assert.ok(pose, 'la pose ne doit pas être nulle après un rendu');
      assert.deepEqual(pose.position, attendu);
    }
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

// Lot triangles synchrones : la trace publie `run.drawnTriangles` tel quel, sans la garde `pending`
// qui masquait `submittedTriangles` — la valeur qu'elle protégeait n'a jamais attendu de retour de
// la carte, elle est donc toujours un nombre dès qu'une image a été soumise, jamais `null`.
test('encoding-submit : drawnTriangles publie run.drawnTriangles, jamais null une fois l’image soumise', async () => {
  installGpuGlobals();
  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const fixture = quadScene();
  const { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    diagnosticDetail: 'trace' as never,
    onDiagnostic: (event) => events.push(event),
  } as never);
  try {
    await backend.prepare();
    const cam = camera();
    backend.render(cam);
    await backend.flush?.();
    backend.render(cam);

    assert.ok(
      (backend.metrics().drawnTriangles ?? 0) > 0,
      'témoin : la caméra voit bien le quad, sans quoi 0 ne prouverait rien',
    );
    const submissions = events.filter((event) => event.phase === 'encoding-submit');
    assert.ok(submissions.length > 0, 'au moins une soumission tracée');
    for (const event of submissions) {
      assert.equal(typeof event.context.drawnTriangles, 'number');
      assert.equal(event.context.drawnTriangles, backend.metrics().drawnTriangles);
    }
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
