// `emitExplorerFrameDiagnostic` (lot 3) : `camera.position` publié est la pose monde de la caméra du
// moteur (`readCameraWorld(...).eye`), jamais `camera.position` lu directement sur la caméra hôte.
// Sous un rig que personne d'autre ne remonte, seule la pose monde discrimine.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { emitExplorerFrameDiagnostic } from './explorerFrameDiagnostic.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { FrameMetrics } from '../sdk-core/index.ts';

test('emitExplorerFrameDiagnostic : la caméra publiée est la pose monde, sous un rig que l’hôte ne remonte pas', () => {
  const rig = new THREE.Object3D();
  rig.position.set(-3, 8, 2);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  rig.add(camera);
  rig.updateWorldMatrix(true, false);
  const attendu = camera.getWorldPosition(new THREE.Vector3()).toArray();
  assert.notDeepEqual(attendu, camera.position.toArray(), 'témoin : le rig déplace bien l’œil');

  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const active = {
    id: 'test-backend',
    metrics: () => ({}) as ReturnType<RenderBackend['metrics']>,
  } as unknown as RenderBackend;

  emitExplorerFrameDiagnostic({
    diagnosticChannel: { enabled: true, detail: 'trace' } as never,
    active,
    camera,
    lookAtTarget: { x: 1, y: 2, z: 3 },
    metricsScratch: {} as FrameMetrics,
    pageIdByUrl: new Map(),
    streamer: { stats: () => ({ resident: 0, evictions: 0 }) } as never,
    measuring: false,
    scope: 'default' as never,
    frameNumber: 1,
    diagnose: (phase, _message, context) => events.push({ phase, context: context as never }),
  });

  assert.equal(events.length, 1);
  const published = events[0].context.camera as { position: number[]; target: number[] };
  assert.deepEqual(published.position, attendu);
  assert.deepEqual(published.target, [1, 2, 3]);
});
