import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { surfaceOf } from './pageSurface.ts';
import { createHostFrameCostAudit, gpuFrameCostSnapshot } from './frameCostAudit.ts';
import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';
import type { FrameMetrics } from '../sdk-core/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

test('opt-in audit: bounded snapshot, deferred, without changing the selection or inventing the GPU mask', async (t) => {
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
    createHostFrameCostAudit()('test', 1, {} as FrameMetrics);
    assert.equal(gpuFrameCostSnapshot({} as WebgpuPagesRuntime), undefined);
    await Promise.resolve();
    assert.equal(output.length, 0);
    setSearch('?wgFrameAudit=1');
    const item = {
      bounds: [10, 0, 0, 11, 1, 1],
      surface: surfaceOf(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
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
    audit('test', 1, metrics);
    audit('test', 2, metrics);
    assert.equal(output.length, 0, 'no console during the measured render call');
    metrics.cpuFrameMs = 99;
    await Promise.resolve();
    assert.equal(output.length, 1, 'one snapshot in the two-second window');
    assert.equal(JSON.parse(output[0]).cpuFrameMs, 42, 'values belong to the captured frame');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('gpuFrameCostSnapshot: the published pose is the engine camera’s (run.gate.cam), under a rig', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?wgFrameAudit=1' },
  });
  try {
    // Two-level rig nobody else walks: the local host camera stays trivial, only the rig carries
    // the translation. `run.lastCamera` is only a truth marker here — its shape must never be read
    // for the pose, only `run.gate.cam` (already resolved) counts.
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
      'the host camera’s local pose (the origin under this rig) is not the published pose',
    );
    assert.equal(snapshot.camera!.fov, cam.fov);
    assert.equal(snapshot.camera!.near, cam.near);
    assert.equal(snapshot.camera!.far, cam.far);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('an item that declares no material is counted as one draw, the host default side', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?wgFrameAudit=1' },
  });
  try {
    // An empty material array declares nothing: the side read is the host default, front, and the
    // item costs one draw. Reading the extracted first element instead would throw here.
    const item = { bounds: [10, 0, 0, 11, 1, 1], surface: surfaceOf([]) };
    const rt = {
      blendState: {
        visibleBlend: [item],
        blendGpu: [item],
        blendPlanes: [-1, 0, 0, 1, ...new Array(20).fill(0)],
      },
      run: { blendDrawCalls: 0 },
      timing: {},
      gpu: { targetSize: [32, 32] },
    } as unknown as WebgpuPagesRuntime;
    const snapshot = gpuFrameCostSnapshot(rt)!;
    assert.equal(snapshot.listedOutsideFrustum, 1);
    assert.equal(snapshot.outsideDrawsIfTextured, 1, 'front, not two faces and not a crash');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
