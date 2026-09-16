import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHostFrameCostAudit, gpuFrameCostSnapshot } from './frameCostAudit.ts';
import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';
import type { FrameMetrics } from '../sdk-core/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

test('audit opt-in : relevé borné, différé, sans modifier la sélection ni inventer le masque GPU', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const output: string[] = [];
  t.mock.method(console, 'info', (_label: string, payload: string) => output.push(payload));
  t.mock.method(performance, 'now', () => 10000);
  const setSearch = (search: string) =>
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { search },
    });
  try {
    setSearch('');
    createHostFrameCostAudit()('test', 1, {} as FrameMetrics, null);
    assert.equal(gpuFrameCostSnapshot({} as WebgpuPagesRuntime), undefined);
    await Promise.resolve();
    assert.equal(output.length, 0);
    setSearch('?wgFrameAudit=1');
    const item = {
      bounds: [10, 0, 0, 11, 1, 1],
      material: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    };
    const items = [item];
    const rt = {
      blendState: {
        visibleBlend: items,
        blendGpu: items,
        blendPlanes: [-1, 0, 0, 1, ...new Array(20).fill(0)],
      },
      run: { blendDrawCalls: 2 },
      timing: {},
      gpu: { targetSize: [32, 32] },
    } as unknown as WebgpuPagesRuntime;
    const snapshot = gpuFrameCostSnapshot(rt)!;
    assert.equal(snapshot.listedOutsideFrustum, 1);
    assert.equal(snapshot.outsideDrawsIfTextured, 2);
    assert.equal(snapshot.gpuEmptyDraws, null);
    assert.equal(items.length, 1);
    assert.equal(items[0], item);
    const audit = createHostFrameCostAudit();
    const metrics = { cpuFrameMs: 42, drawCalls: 2 } as FrameMetrics;
    audit('test', 1, metrics, null);
    audit('test', 2, metrics, null);
    assert.equal(output.length, 0, 'aucune console dans l’appel de rendu');
    metrics.cpuFrameMs = 99;
    await Promise.resolve();
    assert.equal(output.length, 1, 'un seul relevé dans la fenêtre de deux secondes');
    assert.equal(
      JSON.parse(output[0]).cpuFrameMs,
      42,
      'les valeurs appartiennent à la frame capturée',
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('gpuFrameCostSnapshot : la pose publiée est celle de la caméra du moteur (run.gate.cam), sous un rig', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?wgFrameAudit=1' },
  });
  try {
    // Rig à deux niveaux que personne ne remonte ailleurs : la caméra hôte locale reste triviale,
    // seul le rig porte la translation. `run.lastCamera` n'est ici qu'un marqueur de vérité — sa
    // forme ne doit jamais être lue pour la pose, seule `run.gate.cam` (déjà résolue) compte.
    const rig = new THREE.Object3D();
    rig.position.set(3, -6, 9);
    const hostCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    rig.add(hostCamera);
    rig.updateWorldMatrix(true, false);
    const cam = readCameraWorld(createEngineCamera(), hostCamera);
    const rt = {
      blendState: { visibleBlend: [], blendGpu: [], blendPlanes: new Array(24).fill(0) },
      run: { lastCamera: {}, gate: { cam }, blendDrawCalls: 0 },
      timing: {},
      gpu: { targetSize: [32, 32] },
    } as unknown as WebgpuPagesRuntime;
    const snapshot = gpuFrameCostSnapshot(rt)!;
    assert.deepEqual(snapshot.camera!.position, [...cam.eye]);
    assert.notDeepEqual(
      snapshot.camera!.position,
      hostCamera.position.toArray(),
      'la pose locale de la caméra hôte (l’origine sous ce rig) n’est pas la pose publiée',
    );
    assert.equal(snapshot.camera!.fov, cam.fov);
    assert.equal(snapshot.camera!.near, cam.near);
    assert.equal(snapshot.camera!.far, cam.far);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
