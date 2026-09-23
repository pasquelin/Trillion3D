import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dagFixture } from '../page/selection/dag.fixture.ts';
import { collectClusterPages } from '../page/selection/selection.ts';
import { createPrimitiveTemplates } from '../page/selection/template.ts';
import {
  dropBlendBuffers,
  ensureBlendIndexBuffer,
  ensureBlendNormalBuffer,
  ensureBlendUvBuffer,
} from '../webgpu/blend/buffers.ts';
import { createWebgpuGpuState } from '../webgpu/pages/state/gpu.ts';
import type { ClusterManifest, Primitive } from '../../../sdk-core/src/index.ts';

/** A device that only knows how to create buffers and count what is written to them. */
function fakeDevice() {
  Object.assign(globalThis, { GPUBufferUsage: { COPY_DST: 8, STORAGE: 128 } });
  const created: Array<{ size: number; writes: number; destroyed: number }> = [];
  const device = {
    createBuffer({ size }: { size: number }) {
      const entry = { size, writes: 0, destroyed: 0 };
      created.push(entry);
      return { size, destroy: () => entry.destroyed++, entry } as unknown as GPUBuffer;
    },
    queue: {
      writeBuffer(buffer: GPUBuffer) {
        (buffer as unknown as { entry: { writes: number } }).entry.writes++;
      },
    },
  } as unknown as GPUDevice;
  return { device, created };
}

function blendGeometry(withUv: boolean) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  if (withUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

// Behaviour: a transparent's index, UV and normal buffers belong to the geometry. Two placements
// of the same geometry share them, each is written only once and counted only once in
// `vertexBytes`.
test('two placements of the same transparent geometry share indices, UVs and normals', () => {
  const { device, created } = fakeDevice();
  const gpu = createWebgpuGpuState([1, 1]);
  const shared = blendGeometry(true),
    other = blendGeometry(true);
  const index = shared.getIndex()!;
  const first = {
    index: ensureBlendIndexBuffer(device, index, gpu),
    uv: ensureBlendUvBuffer(device, shared.attributes, gpu),
    normal: ensureBlendNormalBuffer(device, shared.attributes, gpu),
  };
  const second = {
    index: ensureBlendIndexBuffer(device, index, gpu),
    uv: ensureBlendUvBuffer(device, shared.attributes, gpu),
    normal: ensureBlendNormalBuffer(device, shared.attributes, gpu),
  };
  assert.equal(second.index, first.index);
  assert.equal(second.uv, first.uv);
  assert.equal(second.normal, first.normal);
  assert.equal(created.length, 3);
  for (const entry of created) assert.equal(entry.writes, 1);
  const bytesOnce = gpu.vertexBytes;
  assert.equal(
    bytesOnce,
    created.reduce((total, entry) => total + entry.size, 0),
  );
  // Another geometry keeps its own.
  ensureBlendIndexBuffer(device, other.getIndex()!, gpu);
  ensureBlendUvBuffer(device, other.attributes, gpu);
  ensureBlendNormalBuffer(device, other.attributes, gpu);
  assert.equal(created.length, 6);
  assert.ok(gpu.vertexBytes > bytesOnce);
  dropBlendBuffers(gpu);
  for (const entry of created) assert.equal(entry.destroyed, 1);
  assert.equal(gpu.blendIndexBuffers.size, 0);
  assert.equal(gpu.blendUvBuffers.size, 0);
  assert.equal(gpu.blendNormalBuffers.size, 0);
});

// Behaviour: a geometry without UVs never fabricates any, and the absence is remembered — the
// second placement does not restart the search and allocates nothing.
test('a transparent geometry without UVs yields `undefined`, once', () => {
  const { device, created } = fakeDevice();
  const gpu = createWebgpuGpuState([1, 1]);
  const geometry = blendGeometry(false);
  assert.equal(ensureBlendUvBuffer(device, geometry.attributes, gpu), undefined);
  assert.equal(ensureBlendUvBuffer(device, geometry.attributes, gpu), undefined);
  assert.equal(created.length, 0);
  assert.equal(gpu.blendUvBuffers.size, 1);
});

/** The same primitive, given a one-leaf-node culling hierarchy. */
function primitiveWithCulling(metadata: ClusterManifest) {
  const primitive = metadata.primitives[0] as Primitive & {
    culling: { version: number; count: number; stride: number; nodes: number[] };
  };
  primitive.culling = {
    version: 1,
    count: 1,
    stride: 15,
    nodes: [-2, -0.5, 0, 2, 0.5, 0, 0, 0, 0, 2.3, 0.2, 0, 0, 0, primitive.pages.length],
  };
  return primitive;
}

// Behaviour: one template per primitive. Two calls yield the same pages, the same hierarchy and
// the same bounds, and a page whose index array contradicts the count its manifest entry
// declares is refused where the template is built.
test('a primitive’s template is computed once and returned as-is to the next placement', () => {
  const fixture = dagFixture();
  const primitive = primitiveWithCulling(fixture.metadata);
  const templates = createPrimitiveTemplates(fixture.indices, false);
  const first = templates.pagesOf(primitive),
    second = templates.pagesOf(primitive);
  assert.equal(second, first);
  const shape = templates.shapeOf(primitive, first);
  assert.equal(templates.shapeOf(primitive, second), shape);
  assert.ok(shape.culling && shape.bounds);
  // A page shorter than its manifest entry is refused at the template that reads it.
  const short = new Map(fixture.indices);
  const head = primitive.pages[0];
  short.set(head.url, new Uint32Array(head.count + 3));
  assert.throws(() => createPrimitiveTemplates(short, false).pagesOf(primitive), {
    message: 'Incomplete cluster coverage',
  });
});

// Behaviour: two instances of an object share the shape of its DAG — hierarchy, per-node bounds,
// group links, cluster identities — and share nothing that distinguishes them: world matrix,
// world box, forced-group flags, page records.
test('two instances share the DAG shape, never what places them', () => {
  const fixture = dagFixture();
  primitiveWithCulling(fixture.metadata);
  const second = new THREE.Mesh(fixture.mesh.geometry, fixture.mesh.material);
  second.position.set(50, 0, 0);
  fixture.source.add(second);
  fixture.associations.set(second, { meshes: 0, primitives: 0 });
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(roots.length, 2);
  assert.equal(allPages.length, roots[0].pages.length * 2);
  assert.equal(roots[0].culling!.nodes, roots[1].culling!.nodes);
  assert.equal(roots[0].culling!.bounds, roots[1].culling!.bounds);
  assert.equal(roots[0].structure, roots[1].structure);
  assert.notEqual(roots[0].forced, roots[1].forced);
  assert.notEqual(roots[0].localBox, roots[1].localBox);
  assert.deepEqual(Array.from(roots[0].localBox!), Array.from(roots[1].localBox!));
  assert.notEqual(roots[0].world, roots[1].world);
  assert.notDeepEqual(Array.from(roots[0].worldBox!), Array.from(roots[1].worldBox!));
  for (let i = 0; i < roots[0].pages.length; i++) {
    const a = roots[0].pages[i],
      b = roots[1].pages[i];
    assert.notEqual(a, b);
    // A cluster's identity is the primitive's: one string for all its placements.
    assert.equal(a.clusterId, b.clusterId);
    assert.equal(a.sphere, b.sphere);
    assert.equal(a.lodError, b.lodError);
    assert.notEqual(a.matrix, b.matrix);
  }
});
