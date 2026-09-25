// #297: the autonomous WebGL2 path files its records under the page's own URL, never under the
// streaming request. A cache that packs a primitive's cluster indices into one bundle gives every
// page of that primitive the same request address: indexed by it, the decoded geometry of one
// page would be filed for the whole primitive and `sync()` would refuse the cut it cannot cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import { autonomousPagesBackend } from './pages.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

/** Two triangles side by side, one cluster page each, both packed in one index bundle. */
const TRIANGLES = [
  new Float32Array([-1, -1, 0, 0, -1, 0, -0.5, 0, 0]),
  new Float32Array([0, -1, 0, 1, -1, 0, 0.5, 0, 0]),
];
const INDEX_BYTES = 12;

function fixture() {
  const encoded = TRIANGLES.map((array) =>
    encodeGeometryPage([0, 1, 2], { POSITION: { itemSize: 3, array } }),
  );
  const pages = TRIANGLES.map((positions, index) => {
    const along = (axis: number) => [0, 3, 6].map((corner) => positions[axis + corner]);
    const page = encoded[index];
    return {
      id: index,
      url: `indices-${index}.bin`,
      // The bundle both pages are read from: `streamUrl` is this one address for the two.
      stream: 0,
      streamOffset: index * INDEX_BYTES,
      sha256: 'x',
      bytes: INDEX_BYTES,
      count: 3,
      min: [0, 1, 2].map((axis) => Math.min(...along(axis))),
      max: [0, 1, 2].map((axis) => Math.max(...along(axis))),
      role: 'exact' as const,
      start: index * 3,
      level: 0,
      lodError: 0,
      sphere: [0, 0, 0, 2],
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
      geometry: {
        url: `geometry-${index}.bin`,
        sha256: 'x',
        bytes: page.data.length,
        vertexCount: page.vertexCount,
        indexCount: page.indexCount,
        flags: page.flags,
        uncompressedBytes: page.uncompressedBytes,
      },
    };
  });
  const metadata = {
    errorModel: 'dag-group-qem-v2',
    clusterStrategy: 'dag-groups',
    geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups',
        pages,
        streams: { pages: [{ url: 'cluster-indices.bin', bytes: pages.length * INDEX_BYTES }] },
        structure: { version: 1, roots: pages.map((_, index) => index), groups: [] },
      },
    ],
  } as unknown as ClusterManifest;
  const bytes = new Map(pages.map((page, index) => [page.geometry.url, encoded[index].data]));
  return { metadata, bytes };
}

test('two pages packed in one bundle each receive their own decoded geometry', async () => {
  const { metadata, bytes } = fixture();
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', new G.BufferAttribute(new Float32Array(18), 3));
  const material = G.basicSurface({ side: G.DOUBLE_SIDE });
  const mesh = G.mesh(geometry, material),
    source = new G.Group();
  source.add(mesh);
  const backend = autonomousPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    readGeometryPage: async (url: string) => bytes.get(url)!,
  });
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  try {
    // Filed under the bundle, the second record would never receive its geometry and `prepare()`
    // would stop on `AUTONOMOUS_COVERAGE_MISSING`, the failure #297 names.
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 2);
    const drawn = backend.scene.children.filter(G.isDrawnNode);
    assert.equal(drawn.length, 2);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
