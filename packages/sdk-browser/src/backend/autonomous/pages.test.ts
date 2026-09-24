import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts';
import { autonomousPagesBackend } from './pages.ts';
import type { ClusterManifest, Material } from '../../../../sdk-core/src/index.ts';
import { createPlacementRows, type PlacementRows } from '../../placement/rows.ts';

/** One triangle cut into one page, and the WebGL2 page path opened on `mesh` placed by `link`. */
function triangleBackend(link: { placements?: PlacementRows } = {}) {
  const position = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const encoded = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
  });
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', new G.GraphAttribute(position, 3));
  geometry.setIndex(G.indices([0, 1, 2]));
  const material = G.basicSurface({ side: G.DOUBLE_SIDE }),
    mesh = G.mesh(geometry, material),
    source = new G.GraphGroup();
  source.add(mesh);
  const descriptor = {
    url: 'triangle-geometry.bin',
    sha256: 'x',
    bytes: encoded.data.length,
    vertexCount: encoded.vertexCount,
    indexCount: encoded.indexCount,
    flags: encoded.flags,
    uncompressedBytes: encoded.uncompressedBytes,
  };
  const page = {
    id: 0,
    url: 'triangle.bin',
    sha256: 'x',
    bytes: 12,
    count: 3,
    min: [-0.5, -0.5, 0],
    max: [0.5, 0.5, 0],
    role: 'exact' as const,
    start: 0,
    level: 0,
    lodError: 0,
    sphere: [0, 0, 0, 1],
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
    geometry: descriptor,
  };
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups',
        pages: [page],
        structure: { version: 1, roots: [0], groups: [] },
      },
    ],
  } as unknown as ClusterManifest;
  const backend = autonomousPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0, ...link }]]),
    readGeometryPage: async () => encoded.data,
    maxResidentPages: 2,
  });
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  return { backend, camera, encoded, geometry, material };
}

test('autonomous pages add, move and remove an instance while keeping page coverage', async () => {
  const { backend, camera, encoded, geometry, material } = triangleBackend();
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1);
    backend.addInstance?.('copy', new G.Matrix4().makeTranslation(1, 0, 0).elements.slice());
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 2);
    backend.updateInstance?.('copy', new G.Matrix4().makeTranslation(2, 0, 0).elements.slice());
    backend.render(camera);
    const copies = backend.scene.children.filter((o) => (o as G.GraphMesh).isMesh) as G.GraphMesh[];
    assert.ok(copies.some((copy) => copy.matrix.elements[12] === 2));
    // The contract carries material parameters, not a host material: the engine builds its own.
    const red: Material = {
      baseColor: [1, 0, 0],
      opacity: 1,
      metalness: 0,
      roughness: 1,
      emissive: [0, 0, 0],
      side: 'double',
      alphaMode: 'opaque',
      alphaCutoff: 0.5,
    };
    backend.updateMaterial?.('0/0', red);
    const painted = copies.map((copy) => copy.material as G.GraphSurface);
    assert.ok(painted.every((material) => material.side === G.DOUBLE_SIDE));
    assert.ok(painted.every((material) => (material.color as G.Color).getHex() === 0xff0000));
    assert.equal(new Set(painted).size, 1);
    const replacementPage = decodeGeometryPage(encoded.data);
    replacementPage.attributes.position[0] = -0.25;
    backend.replaceGeometryPage?.('triangle-geometry.bin', replacementPage);
    backend.acceptGeometryPage?.('triangle-geometry.bin', decodeGeometryPage(encoded.data));
    backend.dropPage?.('triangle-geometry.bin');
    backend.render(camera);
    const updated = backend.scene.children.find((o) => (o as G.GraphMesh).isMesh) as G.GraphMesh;
    assert.equal(updated.geometry.getAttribute('position').getX(0), -0.25);
    assert.equal(backend.metrics().submittedTriangles, 2);
    backend.removeInstance?.('copy');
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a full instance buffer grows in place: its rows kept, the new ones drawn once taken', async () => {
  const from = createPlacementRows(1);
  from.matrices.set(new G.Matrix4().toArray());
  from.live[0] = 1;
  const { backend, camera, geometry, material } = triangleBackend({ placements: from });
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1);
    const held = backend.metrics().geometryAllocationBytes;
    backend.addInstance!('copy', new G.Matrix4().elements.slice());
    assert.equal(backend.metrics().geometryAllocationBytes, held, 'the rows geometry is shared');
    backend.removeInstance!('copy');
    assert.equal(backend.metrics().geometryAllocationBytes, held, 'and not freed with it');
    const to = createPlacementRows(2);
    to.matrices.set(from.matrices);
    to.live.set(from.live);
    backend.growPlacements!(from, to);
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1, 'the new row is parked');
    to.matrices.set(new G.Matrix4().makeTranslation(1, 0, 0).toArray(), 16);
    to.live[1] = 1;
    backend.updatePlacements!(to, 1, 1);
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 2);
    to.live[0] = 0;
    backend.updatePlacements!(to, 0, 0);
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1, 'the kept row reads the grown buffer');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('the WebGL2 path holds the geometry pool and publishes it in its metrics', async () => {
  const { backend, camera, encoded, geometry, material } = triangleBackend();
  try {
    await backend.prepare();
    backend.render(camera);
    const held = backend.metrics();
    assert.equal(held.geometryPoolBytes, 512 * 1024 * 1024);
    assert.equal(held.geometryAllocationBytes, encoded.uncompressedBytes);
    assert.equal(held.geometryPoolAllocatedBytes, null, 'no pool is reserved');
    assert.equal(held.geometryPoolClamp, 'scene');
    // Both budgets are checked before either changes, as on WebGPU.
    const both = { geometryPoolBytes: 1, texturePoolBytes: 0 };
    await assert.rejects(backend.setMemoryBudgets!(both), /INVALID_TEXTURE_POOL_BUDGET/);
    assert.equal(backend.metrics().geometryPoolBytes, 512 * 1024 * 1024, 'nothing changed');
    // A budget under the root cover is raised to it, by name, and evicts nothing drawn.
    const report = await backend.setMemoryBudgets!({ geometryPoolBytes: 1 });
    assert.equal(report.geometryPool.clamp, 'root-cover');
    assert.deepEqual([report.evictedPages, report.texturePool], [0, null]);
    backend.render(camera);
    const { geometryPoolBytes, submittedTriangles } = backend.metrics();
    assert.deepEqual([geometryPoolBytes, submittedTriangles], [1, 1]);
    assert.deepEqual(report.residentPages, { before: 1, after: backend.metrics().residentPages });
    // A classic instance holds its own copy of the page, a second slot; rows share theirs.
    backend.addInstance!('copy', new G.Matrix4().elements.slice());
    assert.equal(backend.metrics().geometryPoolSlots, 2);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
