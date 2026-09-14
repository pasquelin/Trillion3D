import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationColorDiagnostic } from './index.ts';
import { outputColorDiagnostic, webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('the GPU readback diagnostic distinguishes the requested clear color from the rendered pixels', () => {
  const pixels = new Uint8Array([42, 48, 60, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
  assert.deepEqual(outputColorDiagnostic(pixels, 2, 2, 0x2a303c), {
    clearColor: '#2a303c',
    topLeft: '#2a303c',
    center: '#070809',
    matchesClearAtTopLeft: true,
  });
});

test('the presentation diagnostic exposes the final capture pixel separately from the WebGPU target', () => {
  const pixels = new Uint8Array([42, 48, 60, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
  assert.deepEqual(presentationColorDiagnostic(pixels, 2, 2, 0x2a303c), {
    clearColor: '#2a303c',
    topLeft: '#2a303c',
    center: '#070809',
    matchesClearAtTopLeft: true,
    surface: 'webgl-capture-target',
  });
});

test('the presentation diagnostic identifies a pixel read from the visible WebGL framebuffer', () => {
  const pixels = new Uint8Array([42, 48, 60, 255]);
  assert.deepEqual(
    presentationColorDiagnostic(pixels, 1, 1, 0x2a303c, 'default-webgl-framebuffer'),
    {
      clearColor: '#2a303c',
      topLeft: '#2a303c',
      center: '#2a303c',
      matchesClearAtTopLeft: true,
      surface: 'default-webgl-framebuffer',
    },
  );
});

test('WebGPU forwards its internal color diagnostics to the host report sink', async () => {
  installGpuGlobals();
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = [];
  const { device } = mockGpu();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    clearColor: 0x2a303c,
    onDiagnostic: (event) => events.push(event),
  });
  assert.deepEqual(events[0], {
    phase: 'clear-color-input',
    message: 'Couleur de fond reçue par WebGeometry WebGPU',
    context: { pipelineVersion: 1, clearColor: '#2a303c', value: 0x2a303c, source: 'hôte' },
  });
  await backend.prepare();
  backend.render(camera());
  assert.ok(events.some((event) => event.phase === 'first-render-path'));
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('trace diagnostics retain one bounded snapshot for every rendered frame', async () => {
  installGpuGlobals();
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = [];
  const fixture = quadScene();
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const { device } = mockGpu(undefined, packDagSelection(collected.roots));
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
    backend.render(camera());
    await backend.flush();
    backend.render(camera());
    await backend.flush();
    const frames = events.filter((event) => event.phase === 'frame');
    assert.equal(frames.length, 2);
    assert.deepEqual(
      frames.map((event) => event.context.frame),
      [1, 2],
    );
    assert.ok(frames.every((event) => typeof event.context.submission === 'number'));
    assert.ok(
      frames.every((event) => event.context.coverage && typeof event.context.coverage === 'object'),
    );
    assert.equal(events.filter((event) => event.phase === 'cpu-selection').length, 0);
    assert.ok(events.some((event) => event.phase === 'residency-queue'));
    for (const phase of ['cpu-lights', 'gpu-selection-current-frame'])
      assert.ok(
        events.some((event) => event.phase === phase),
        phase,
      );
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('summary diagnostics keep frame traces disabled', async () => {
  installGpuGlobals();
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = [];
  const fixture = quadScene();
  const { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    diagnosticDetail: 'summary' as never,
    onDiagnostic: (event) => events.push(event),
  } as never);
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush();
    assert.equal(
      events.some((event) => event.phase === 'frame'),
      false,
    );
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
