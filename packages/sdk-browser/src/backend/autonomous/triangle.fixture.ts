import * as G from '../../host/graph/graph.fixture.ts';
import { pagedManifest } from './geometryPages.fixture.ts';
import { autonomousPagesBackend } from './pages.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { createPlacementRows, type PlacementRows } from '../../placement/rows.ts';
import type { BackendContext } from '../types.ts';

/** `count` live rows, side by side. */
export function liveRows(count: number) {
  const rows = createPlacementRows(count);
  for (let row = 0; row < count; row++) {
    rows.matrices.set(new G.Matrix4().makeTranslation(row, 0, 0).toArray(), row * 16);
    rows.live[row] = 1;
  }
  return rows;
}

/** One triangle cut into one page, and the WebGL2 page path opened on `mesh`, under `source`,
 *  placed by `link`, wearing `material` (a basic double-sided surface by default), under the page
 *  `ceiling` (a host ceiling of two pages by default); `pass` the primitive's (exact clusters).
 *  With `twinScale`, a second mesh draws the same primitive at that scale. */
export function triangleBackend(
  {
    pass = 'exact-clusters',
    twinScale,
    ...link
  }: { placements?: PlacementRows; pass?: string; twinScale?: number } = {},
  material: G.GraphSurface = G.basicSurface({ side: G.DOUBLE_SIDE }),
  ceiling: Pick<BackendContext, 'maxResidentPages' | 'residentPagesDefault'> = {
    maxResidentPages: 2,
  },
) {
  const position = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const geometry = new G.Geometry();
  geometry.setAttribute('position', new G.BufferAttribute(position, 3));
  geometry.setIndex(G.indices([0, 1, 2]));
  const mesh = G.mesh(geometry, material),
    source = new G.Group();
  source.add(mesh);
  const twin = twinScale === undefined ? undefined : G.mesh(geometry, material);
  if (twin) {
    twin.scale.setScalar(twinScale!);
    source.add(twin);
  }
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
      errorModel: 'dag-group-qem-v3',
      clusterStrategy: 'dag-groups',
      primitives: [
        {
          mesh: 0,
          primitive: 0,
          pass,
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
    associations: new Map([
      [mesh, { meshes: 0, primitives: 0, ...link }],
      ...(twin ? [[twin, { meshes: 0, primitives: 0 }] as const] : []),
    ]),
    readGeometryPage: paged.readGeometryPage,
    // The index page: the corners of the triangle, as the source numbers them.
    readPage: async () => Uint32Array.of(0, 1, 2),
    ...ceiling,
  });
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const encoded = paged.encoded.get('triangle-geometry.bin')!;
  return { backend, camera, encoded, geometry, material, mesh, source, paged };
}

/** The meshes the display graph draws the pages with, once `camera` rendered a frame. */
export function drawnPageMeshes({ backend, camera }: ReturnType<typeof triangleBackend>) {
  backend.render(camera);
  return (backend.scene as unknown as G.Group).children.filter(
    (child): child is G.Mesh => 'geometry' in child,
  );
}
