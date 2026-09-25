import * as G from '../../host/graph/graph.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

export function blendFixture(
  material: G.GraphSurface = G.basicSurface({
    transparent: true,
    side: G.DOUBLE_SIDE,
  }),
) {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0, 99, -1, 0, 101, -1, 0, 100, 1, 0], 3),
  );
  geometry.setIndex(G.indices([0, 1, 2, 3, 4, 5]));
  const mesh = G.mesh(geometry, material),
    source = new G.Group();
  source.add(mesh);
  // Two level-0 clusters that nothing replaces: the smallest legal DAG, so both are root clusters.
  const pages = [
    {
      id: 0,
      url: 'near',
      count: 3,
      bytes: 12,
      sha256: 'near',
      min: [-1, -1, 0],
      max: [1, 1, 0],
      role: 'exact' as const,
      start: 0,
      level: 0,
      lodError: 0,
      sphere: [0, 0, 0, 1.5],
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
    },
    {
      id: 1,
      url: 'far',
      count: 3,
      bytes: 12,
      sha256: 'far',
      min: [99, -1, 0],
      max: [101, 1, 0],
      role: 'exact' as const,
      start: 3,
      level: 0,
      lodError: 0,
      sphere: [100, 0, 0, 1.5],
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
    },
  ];
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'clustered-blend',
        clusterStrategy: 'dag-groups' as const,
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
      },
    ],
  } as unknown as ClusterManifest;
  const indices = new Map([
    ['near', new Uint32Array([0, 1, 2])],
    ['far', new Uint32Array([3, 4, 5])],
  ]);
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  return { geometry, material, mesh, source, metadata, indices, associations };
}

export function camera() {
  const camera = G.perspectiveCamera(55, 1, 0.1, 1000);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}
