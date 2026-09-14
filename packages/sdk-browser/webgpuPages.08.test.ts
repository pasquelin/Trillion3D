import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages } from '../sdk-core/index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { rasterVisibilityIds, shadeVisibility, unpackVisibilityId } from './visibilityBuffer.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('webgpu Hi-Z remaining pages stay a subset of the CPU selection oracle', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -0.2, -0.2, -2, 0.2, -0.2, -2, 0.2, 0.2, -2, -0.2,
        0.2, -2,
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const pages = dagRoots([
    {
      id: 0,
      url: 'front',
      count: 6,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 24,
      sha256: 'x',
    },
    {
      id: 1,
      url: 'back',
      count: 6,
      min: [-0.2, -0.2, -2] as number[],
      max: [0.2, 0.2, -2] as number[],
      bytes: 24,
      sha256: 'x',
    },
  ]);
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
      },
    ],
  };
  const indices = new Map([
    ['front', new Uint32Array([0, 1, 2, 0, 2, 3])],
    ['back', new Uint32Array([4, 5, 6, 4, 6, 7])],
  ]);
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
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
  });
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cam, { pixelError: 0, viewport, frame: 1 });
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), false);
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  const selected = cpu.shown.map((page) => page.url).sort();
  assert.deepEqual(backend.selectedPageIds().sort(), selected);
  assert.deepEqual(selected, ['back', 'front']);
  const visPages = cpu.shown
    .filter((page) => page.array)
    .map((page) => ({ ...page, array: page.array! }));
  assert.equal(
    compareImages(
      backend.rasterRgba(),
      shadeVisibility(rasterVisibilityIds(visPages, cam, viewport), visPages, cam, viewport),
    ).maxChannelError,
    0,
  );
  const drawn = new Set(
    [...backend.visibilityIds()].flatMap((id) => {
      const unpacked = unpackVisibilityId(id);
      return unpacked ? [unpacked.pageIndex] : [];
    }),
  );
  assert.deepEqual([...drawn].sort(), [0]);
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
  });
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
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
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
  geometry.dispose();
  material.dispose();
});
