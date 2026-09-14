import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { coarseQuadScene } from './webgpuPagesTestOccluder.ts';

test('clustered transparency submits only visible pages in one two-sided mesh draw', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, draws, writes } = mockGpu();
  fixture.material.transparent = true;
  fixture.material.side = THREE.DoubleSide;
  fixture.geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 0, 1, 0, 99, -1, 0, 101, -1, 0, 100, 1, 0],
      3,
    ),
  );
  fixture.geometry.setIndex([0, 1, 2, 3, 4, 5]);
  fixture.indices.set('1', new Uint32Array([3, 4, 5]));
  const primitive = fixture.metadata.primitives[0];
  primitive.pass = 'clustered-blend';
  primitive.pages[1].min = [99, -1, 0];
  primitive.pages[1].max = [101, 1, 0];
  primitive.hierarchy = {
    min: [-1, -1, 0],
    max: [101, 1, 0],
    children: primitive.pages.map((p) => ({ min: p.min, max: p.max, page: p.id })),
  };
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush();
    draws.length = 0;
    backend.render(camera());
    assert.equal(backend.metrics().transparentSubmittedTriangles, 2);
    assert.equal(backend.metrics().transparentDrawCalls, 2);
    assert.equal(backend.metrics().transparentMeshes, 1);
    assert.equal(
      backend.metrics().submittedTriangles,
      2,
      'transparent pages never enter the opaque pass',
    );
    assert.equal(
      draws.filter((d) => d.entryPoint === 'vs').reduce((n, d) => n + d.vertexCount, 0),
      6,
    );
    const uploads = writes.length;
    backend.render(camera());
    assert.equal(
      writes.slice(uploads).filter((w) => w.bytes.byteLength === 12).length,
      0,
      'stable cuts do not upload indices again',
    );
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('clustered transparency does not duplicate forward attributes in opaque GPU buffers', async () => {
  installGpuGlobals();
  const allocations: number[] = [];
  for (const pass of ['shared-blend', 'clustered-blend']) {
    const fixture = quadScene(),
      { device } = mockGpu();
    fixture.material.transparent = true;
    fixture.metadata.primitives[0].pass = pass;
    const positions = new Float32Array(3000);
    positions.set(fixture.geometry.getAttribute('position').array);
    fixture.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const backend = webgpuPagesBackend({
      ...fixture,
      gpuDevice: device,
      maxResidentPages: 2,
      viewport: [32, 32],
    });
    try {
      await backend.prepare();
      backend.render(camera());
      allocations.push(backend.metrics().geometryAllocationBytes);
    } finally {
      await backend.dispose();
      fixture.geometry.dispose();
      fixture.material.dispose();
    }
  }
  assert.ok(
    allocations[1] <= allocations[0] + 1024,
    'page indices may add slots; forward vertices must not be copied into opaque position/UV/normal buffers',
  );
});

test('clustered transparency switches LOD with resident coverage and retains both face passes', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene(),
    { device } = mockGpu();
  fixture.material.transparent = true;
  fixture.material.side = THREE.DoubleSide;
  fixture.metadata.primitives[0].pass = 'clustered-blend';
  fixture.metadata.primitives[0].pages[2].count = 3;
  fixture.metadata.primitives[0].pages[2].bytes = 12;
  fixture.indices.set('2', new Uint32Array([0, 1, 2]));
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => fixture.indices.get(url)!,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      2,
      'coarse coverage drawn while detail is missing',
    );
    backend.acceptPage!('0', fixture.indices.get('0')!);
    backend.syncResident!();
    await backend.flush();
    backend.render(camera());
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      2,
      'partial detail cannot replace coverage',
    );
    backend.acceptPage!('1', fixture.indices.get('1')!);
    backend.syncResident!();
    await backend.flush();
    backend.render(camera());
    assert.equal(backend.metrics().transparentSubmittedTriangles, 4);
    assert.equal(
      backend.metrics().transparentDrawCalls,
      2,
      'pages are merged in source order for each face pass',
    );
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
