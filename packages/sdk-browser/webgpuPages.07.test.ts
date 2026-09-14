import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages } from '../sdk-core/index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { rasterVisibilityIds, shadeVisibility } from './visibilityBuffer.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('GPU page ids skip a non-hierarchy primitive that sits first in allPages', async () => {
  installGpuGlobals();
  const geoA = new THREE.BufferGeometry();
  geoA.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0], 3),
  );
  geoA.setIndex([0, 1, 2]);
  const geoB = new THREE.BufferGeometry();
  geoB.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([8, -1, 0, 10, -1, 0, 10, 1, 0], 3),
  );
  geoB.setIndex([0, 1, 2]);
  const material = new THREE.MeshBasicMaterial(),
    meshA = new THREE.Mesh(geoA, material),
    meshB = new THREE.Mesh(geoB, material),
    source = new THREE.Group();
  source.add(meshA, meshB);
  const pagesA = dagRoots([
    {
      id: 0,
      url: 'orphan',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
  ]);
  const pagesB = dagRoots([
    {
      id: 0,
      url: 'exact',
      count: 3,
      min: [8, -1, 0] as number[],
      max: [10, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
  ]);
  const structure = { version: 1, roots: [0], groups: [] };
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      { mesh: 0, primitive: 0, pass: 'exact-clusters', pages: pagesA, structure },
      { mesh: 1, primitive: 0, pass: 'exact-clusters', pages: pagesB, structure },
    ],
  };
  const indices = new Map([
    ['orphan', new Uint32Array([0, 1, 2])],
    ['exact', new Uint32Array([0, 1, 2])],
  ]);
  const associations = new Map([
    [meshA, { meshes: 0, primitives: 0 }],
    [meshB, { meshes: 1, primitives: 0 }],
  ]);
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device } = mockGpu(undefined, packed);
  const viewport: [number, number] = [32, 32];
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
  });
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(9, 0, 5);
  cam.lookAt(9, 0, 0);
  cam.updateMatrixWorld();
  await backend.prepare();
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  assert.deepEqual(backend.selectedPageIds(), ['exact']);
  backend.dispose();
  geoA.dispose();
  geoB.dispose();
  material.dispose();
});

test('a failed GPU selection readback falls back to the CPU cut and clears gpuDriven', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device } = mockGpu(undefined, packed, true);
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
  assert.equal(backend.capabilities.gpuDriven, true);
  backend.render(camera());
  await backend.flush();
  assert.equal(backend.capabilities.gpuDriven, false);
  backend.render(camera());
  assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu visbuffer ids match the CPU oracle for a stable pose', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
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
  const cam = camera();
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), false);
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  const mesh = source.children[0] as THREE.Mesh;
  const pages = [
    {
      array: indices.get('0')!,
      attributes: geometry.attributes,
      matrix: mesh.matrixWorld,
      material,
    },
    {
      array: indices.get('1')!,
      attributes: geometry.attributes,
      matrix: mesh.matrixWorld,
      material,
    },
  ];
  const expected = rasterVisibilityIds(pages, cam, [32, 32]);
  const observed = backend.visibilityIds();
  assert.deepEqual(observed, expected);
  assert.deepEqual(observed, backend.visibilityIds());
  const image = compareImages(
    backend.rasterRgba(),
    shadeVisibility(expected, pages, cam, [32, 32]),
  );
  assert.equal(image.maxChannelError, 0);
  const maps = textures.find((t) => t.format === 'rgba8unorm-srgb');
  assert.ok(maps);
  assert.ok(maps.depthOrArrayLayers >= 2);
  assert.ok(maps.views.some((view) => view?.dimension === '2d-array'));
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
