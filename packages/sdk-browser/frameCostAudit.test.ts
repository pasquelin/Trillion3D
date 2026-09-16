import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHostFrameCostAudit, gpuFrameCostSnapshot } from './frameCostAudit.ts';
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
