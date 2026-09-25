import * as G from '../../host/graph/graph.fixture.ts';
import { pagedManifest } from './geometryPages.fixture.ts';
import { autonomousPagesBackend } from './pages.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { PlacementRows } from '../../placement/rows.ts';

/** One triangle cut into one page, and the WebGL2 page path opened on `mesh`, under `source`,
 *  placed by `link`, wearing `material` (a basic double-sided surface by default). */
export function triangleBackend(
  link: { placements?: PlacementRows } = {},
  material: G.GraphSurface = G.basicSurface({ side: G.DOUBLE_SIDE }),
) {
  const position = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', new G.GraphAttribute(position, 3));
  geometry.setIndex(G.indices([0, 1, 2]));
  const mesh = G.mesh(geometry, material),
    source = new G.Group();
  source.add(mesh);
  const page = {
    id: 0,
    url: 'triangle',
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
  };
  const paged = pagedManifest(
    {
      errorModel: 'dag-group-qem-v1',
      clusterStrategy: 'dag-groups',
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
    } as unknown as ClusterManifest,
    [geometry],
  );
  const backend = autonomousPagesBackend({
    source,
    metadata: paged.metadata,
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0, ...link }]]),
    readGeometryPage: paged.readGeometryPage,
    maxResidentPages: 2,
  });
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const encoded = paged.encoded.get('triangle-geometry.bin')!;
  return { backend, camera, encoded, geometry, material, mesh, source };
}
