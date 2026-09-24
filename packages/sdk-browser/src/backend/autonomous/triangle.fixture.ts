import * as G from '../../host/graph/graph.fixture.ts';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import { autonomousPagesBackend } from './pages.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { PlacementRows } from '../../placement/rows.ts';

/** One triangle cut into one page, and the WebGL2 page path opened on `mesh`, under `source`,
 *  placed by `link`. */
export function triangleBackend(link: { placements?: PlacementRows } = {}) {
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
  return { backend, camera, encoded, geometry, material, mesh, source };
}
