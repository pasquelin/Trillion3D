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
    // One visible cluster of one triangle, rasterised by both face passes: the triangle is counted
    // once, the two passes show in the draw calls.
    assert.equal(backend.metrics().transparentSubmittedTriangles, 1);
    assert.equal(backend.metrics().transparentDrawCalls, 2);
    assert.equal(backend.metrics().transparentMeshes, 1);
    const blend = draws.filter((d) => d.indirect && d.entryPoint === 'vs');
    assert.equal(blend.length, 2, 'both face passes draw indirectly');
    for (const draw of blend) assert.equal(draw.instanceCount, 1, 'one instance per kept cluster');
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

test('clustered transparency reads the opaque geometry instead of copying it', async () => {
  installGpuGlobals();
  const allocations: number[] = [];
  // La passe transparente paginée lit la géométrie CONCATÉNÉE, celle que la passe opaque lit déjà :
  // c'est ce qui lui permet de partager un seul groupe de liaison pour tous ses items. La même
  // primitive doit donc coûter exactement la même chose, qu'on la dessine opaque ou transparente ;
  // une copie propre aux transparents se verrait ici comme un supplément d'octets.
  for (const pass of ['exact-clusters', 'clustered-blend']) {
    const fixture = quadScene(),
      { device } = mockGpu();
    fixture.material.transparent = pass === 'clustered-blend';
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
    'page indices may add slots; forward vertices must not be copied a second time',
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
      1,
      'coarse coverage drawn while detail is missing',
    );
    backend.acceptPage!('0', fixture.indices.get('0')!);
    backend.syncResident!();
    await backend.flush();
    backend.render(camera());
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      1,
      'partial detail cannot replace coverage',
    );
    backend.acceptPage!('1', fixture.indices.get('1')!);
    backend.syncResident!();
    await backend.flush();
    backend.render(camera());
    assert.equal(backend.metrics().transparentSubmittedTriangles, 2);
    assert.equal(
      backend.metrics().transparentDrawCalls,
      2,
      'one indirect draw per face pass, however many clusters the compaction kept',
    );
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
