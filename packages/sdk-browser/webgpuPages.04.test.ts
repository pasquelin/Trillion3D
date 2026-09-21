import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from './index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { camera, quadBackend } from './webgpuPagesTestScenes.ts';
import { coarseQuadScene } from './webgpuPagesTestOccluder.ts';

test('the initial cover also protects regions first discovered after a camera jump', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 100, -1, 0, 102, -1, 0, 102, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const pages = dagRoots([
    {
      id: 0,
      url: '0',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
    {
      id: 1,
      url: '1',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
    {
      id: 2,
      url: '2',
      count: 3,
      min: [100, -1, 0] as number[],
      max: [102, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
  ]);
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    schema: 1,
    status: 'ready',
    key: 'k',
    scope: 'full' as const,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: [],
    totalNodes: 0,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: [0, 1, 2], groups: [] },
      },
    ],
  };
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
    ['2', new Uint32Array([4, 5, 6])],
  ]);
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  });
  await backend.prepare();
  const cam = camera();
  backend.render(cam);
  await backend.flush?.();
  backend.render(cam);
  const first = backend.metrics().residentPages;
  assert.equal(first, 2);
  cam.position.set(101, 0, 5);
  cam.lookAt(101, 0, 0);
  cam.updateMatrixWorld();
  backend.render(cam);
  await backend.flush?.();
  backend.render(cam);
  assert.equal(backend.metrics().residentPages, 1);
  assert.equal(backend.metrics().cacheEvictions, 0);
  assert.equal(backend.overBudget, false);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu pages select the same coarse LOD cut as the WebGL2 exact backend', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
  const {
    source,
    metadata,
    indices: allIndices,
    associations,
    geometry,
    material,
  } = coarseQuadScene(0.001);
  const context = {
    source,
    metadata,
    indices: allIndices,
    associations,
    pixelError: 10,
    viewport: [960, 540] as [number, number],
  };
  const webgl = exactPagesBackend(context);
  const webgpu = webgpuPagesBackend({ ...context, gpuDevice: device, maxResidentPages: 4 });
  const cam = camera();
  webgl.render(cam);
  await webgpu.prepare();
  webgpu.render(cam);
  await webgpu.flush?.();
  webgpu.render(cam);
  assert.equal(webgpu.metrics().clusters, webgl.metrics().clusters);
  assert.equal(webgpu.metrics().selectedTriangles, webgl.metrics().selectedTriangles);
  webgl.dispose();
  webgpu.dispose();
  geometry.dispose();
  material.dispose();
});

test('a lost WebGPU device fails the backend without throwing from dispose', async () => {
  installGpuGlobals();
  const { device, lose } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  lose('destroyed');
  await Promise.resolve();
  assert.throws(() => backend.render(camera()), /WEBGPU_LOST/);
  await backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('the lost promise unpublishes the composed canvas and names WEBGPU_LOST', async () => {
  installGpuGlobals();
  const { device, lose } = mockGpu();
  let unconfigured = false;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      configure() {},
      getCurrentTexture: () => ({ createView: () => ({}) }),
      unconfigure() {
        unconfigured = true;
      },
    }),
  };
  // The composed presentation needs a canvas of the engine's own: the document hands it out.
  Object.assign(globalThis, { document: { createElement: () => canvas } });
  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic: (e) => {
      // Announced after the withdrawal: a host drawing on it already finds no canvas.
      if (e.phase === 'gpu-device-lost') assert.equal(backend.presentedSurface, undefined);
      events.push(e);
    },
  });
  try {
    await backend.prepare();
    backend.render(camera());
    assert.equal(backend.presentedSurface, canvas, 'the composed canvas is published');
    lose('destroyed');
    await Promise.resolve();
    assert.equal(backend.presentedSurface, undefined, 'a lost device publishes no canvas');
    assert.equal(unconfigured, true, 'the drawing buffer is blanked');
    assert.equal(backend.metrics().frameHeld, false);
    const lost = events.find((e) => e.phase === 'gpu-device-lost');
    assert.equal(lost?.context.code, 'WEBGPU_LOST');
    assert.equal(lost?.context.reason, 'destroyed');
    assert.throws(() => backend.render(camera()), /WEBGPU_LOST/);
  } finally {
    await backend.dispose();
    delete (globalThis as { document?: unknown }).document;
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
