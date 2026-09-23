import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationColorDiagnostic } from './measurement.ts';
import { outputColorDiagnostic, webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera, quadBackend } from './webgpuPagesTestScenes.ts';

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
  const { fixture, backend } = quadBackend(device, {
    clearColor: 0x2a303c,
    onDiagnostic: (event) => events.push(event),
  });
  assert.deepEqual(events[0], {
    phase: 'clear-color-input',
    message: 'Background colour received by WebGeometry WebGPU',
    context: { pipelineVersion: 1, clearColor: '#2a303c', value: 0x2a303c, source: 'host' },
  });
  await backend.prepare();
  backend.render(camera());
  assert.ok(events.some((event) => event.phase === 'first-render-path'));
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
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
    onDiagnostic: (event: { phase: string; message: string; context: Record<string, unknown> }) =>
      events.push(event),
  } as never);
  assert.ok(backend.flush, 'this backend always publishes flush()');
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush();
    backend.render(camera());
    await backend.flush();
    // Two host images, and no convergence image: with no streamed texture, the barrier has
    // nothing to converge and yields nothing.
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
    assert.ok(
      events.some((event) => event.phase === 'gpu-selection-current-frame'),
      'gpu-selection-current-frame',
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
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device, {
    diagnosticDetail: 'summary' as never,
    onDiagnostic: (event) => events.push(event),
  });
  assert.ok(backend.flush, 'this backend always publishes flush()');
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
