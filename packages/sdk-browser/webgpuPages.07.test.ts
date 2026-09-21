import test from 'node:test';
import { MANIFEST_IDENTITY } from './pagesBackendFixture.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages, type ClusterManifest } from '../sdk-core/index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { rasterVisibilityIds, shadeVisibility } from './visibilityBuffer.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera, rootPage, twoPrimitives } from './webgpuPagesTestScenes.ts';
import { cameraMoteur } from './cameraFixture.ts';

/** The mock GPU always builds the full backend; these tests reach the WebGPU-only members the
 *  general `RenderBackend` contract leaves optional or omits. */
type PagesBackend = ReturnType<typeof webgpuPagesBackend> & {
  flush(): Promise<void>;
  selectedPageIds(): string[];
  visibilityIds(): Uint32Array;
  rasterRgba(): Uint8Array;
};

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
  const {
    metadata: metadataPartial,
    indices,
    associations,
  } = twoPrimitives(
    meshA,
    meshB,
    rootPage('orphan', [-1, -1, 0], [1, 1, 0]),
    rootPage('exact', [8, -1, 0], [10, 1, 0]),
  );
  const metadata: ClusterManifest = { ...metadataPartial, ...MANIFEST_IDENTITY };
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
  }) as PagesBackend;
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
  }) as PagesBackend;
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
  }) as PagesBackend;
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
  const expected = rasterVisibilityIds(pages, cameraMoteur(cam), [32, 32]);
  const observed = backend.visibilityIds();
  assert.deepEqual(observed, expected);
  assert.deepEqual(observed, backend.visibilityIds());
  const image = compareImages(
    backend.rasterRgba(),
    shadeVisibility(expected, pages, cameraMoteur(cam), [32, 32]),
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
