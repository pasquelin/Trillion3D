import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './pages.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from './testScenes.fixture.ts';
import { coarseQuadScene } from './testOccluder.fixture.ts';
import type { WebgpuPagesBackend } from './runtime.ts';

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
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as WebgpuPagesBackend;
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
  // The paged transparent pass reads the CONCATENATED geometry, the one the opaque pass already
  // reads: that is what lets it share a single bind group for all its items. The same primitive
  // must therefore cost exactly the same, drawn opaque or transparent; a copy owned by transparents
  // would show up here as extra bytes.
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
      const bytes = backend.metrics().geometryAllocationBytes;
      assert.ok(typeof bytes === 'number');
      allocations.push(bytes);
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
  }) as WebgpuPagesBackend;
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

/** A transparent's material belongs to the host, which shares it with the mesh and can switch it
 *  to double-sided between two images. The item then posts TWO plan entries instead of one, and
 *  its expanded list must hold instances of both — otherwise the kernel silently drops out-of-bounds
 *  writes, and the transparent geometry vanishes without an error. */
test('a transparent switched to double-sided still expands all its instances', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, draws, buffers } = mockGpu();
  fixture.material.transparent = true;
  // Single-sided at prepare: one plan entry, and half the room.
  fixture.material.side = THREE.FrontSide;
  fixture.metadata.primitives[0].pass = 'clustered-blend';
  const mesh = fixture.source.children[0] as THREE.Mesh;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as WebgpuPagesBackend;
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush();
    fixture.material.side = THREE.DoubleSide;
    // A move, and the scene rebuilds its plan: that is where the item gains its second entry.
    mesh.position.x = 0.1;
    mesh.updateMatrixWorld(true);
    draws.length = 0;
    backend.render(camera());
    const blend = draws.filter((draw) => draw.indirect && draw.entryPoint === 'vs');
    assert.equal(blend.length, 2, 'both faces are encoded');
    const instances = blend.reduce((total, draw) => total + (draw.instanceCount ?? 0), 0);
    assert.ok(instances > 0, 'both faces expand instances');
    const etale = buffers.find((buffer) => buffer.label === 'WG blend expanded instances');
    assert.ok(
      etale && etale.data.length >= instances * 8,
      `the expanded list holds ${instances} instances`,
    );
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
