import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from '../pages.ts';
import { collectClusterPages, selectVisiblePages } from '../../../page/selection/selection.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera, quadBackend } from '../testScenes.fixture.ts';
import { assertOccluderImage, occluderScene } from '../testOccluder.fixture.ts';
import { cameraMoteur } from '../../../camera/camera.fixture.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';
import { DEFAULT_SCOPE, type ClusterManifest } from '../../../../../sdk-core/src/index.ts';

test('webgpu Hi-Z remaining pages stay a subset of the CPU selection oracle', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const scene = occluderScene();
  const { source, indices, associations, geometry, material } = scene;
  // `occluderScene` builds `metadata` with only `errorModel`/`clusterStrategy`/`primitives`: the
  // rest of `ClusterManifest` is never read past `primitives`, so it is filled with placeholders.
  const metadata: ClusterManifest = {
    schema: 0,
    status: 'ready',
    key: 'test-occluder',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: [],
    totalNodes: 0,
    ...scene.metadata,
  };
  const viewport: [number, number] = [32, 32];
  const collected = collectClusterPages(source, metadata, indices, associations);
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
  }) as WebgpuPagesBackend;
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cameraMoteur(cam), {
    pixelError: 0,
    viewport,
  });
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), false);
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  const selected = cpu.shown.map((page) => page.url).sort();
  assert.deepEqual(backend.selectedPageIds().sort(), selected);
  assert.deepEqual(selected, ['back', 'front']);
  assertOccluderImage(backend, cpu.shown, cam, viewport);
  assert.ok(
    (backend.metrics().submittedTriangles ?? 0) < (backend.metrics().selectedTriangles ?? 0),
  );
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a visbuffer encode failure restores occlusion culling as unsupported', async () => {
  installGpuGlobals();
  const { device } = mockGpu(undefined, undefined, false, false, true);
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  }) as WebgpuPagesBackend;
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), false);
  const cam = camera();
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), true);
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), true);
  backend.render(cam);
  const failures = events.filter((event) => event.phase === 'visibility-render-failed');
  assert.equal(failures.length, 1, 'a repeated fallback must not flood diagnostic logs');
  assert.equal(typeof failures[0].context.error, 'string');
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a missing r32uint vis target keeps the page raster and lists visibility buffer as unsupported', async () => {
  installGpuGlobals();
  const { device, draws } = mockGpu(undefined, undefined, false, true);
  const { fixture, backend: created } = quadBackend(device);
  const backend = created as WebgpuPagesBackend;
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), true);
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), true);
  backend.render(camera());
  await backend.flush();
  draws.length = 0;
  backend.render(camera());
  assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
  assert.equal(
    draws.reduce((n, d) => n + d.vertexCount, 0),
    6,
  );
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
