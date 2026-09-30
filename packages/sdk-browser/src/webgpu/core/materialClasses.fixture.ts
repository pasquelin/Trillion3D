import * as G from '../../host/graph/graph.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

const page = (id: number, url: string, start: number) => ({
  id,
  url,
  count: 3,
  bytes: 12,
  sha256: url,
  min: [-1, -1, 0],
  max: [1, 1, 0],
  role: 'exact' as const,
  start,
  level: 0,
  lodError: 0,
  sphere: [0, 0, 0, 1.5],
  parentError: null,
  parentSphere: null,
  group: null,
  source: null,
});

/** Three primitives, one per material class, the way the compiler classifies them. */
export function scene() {
  const source = new G.Group(),
    meshes: G.HostMesh[] = [],
    associations = new Map<G.Object3D, { meshes: number; primitives: number }>();
  const materials = [
    // A cut-out: alphaMode MASK carries an alpha test and is not blended.
    G.standardSurface({ alphaTest: 0.5, side: G.DOUBLE_SIDE }),
    // A blend: alphaMode BLEND.
    G.standardSurface({ transparent: true, opacity: 0.4 }),
    // Transmission: thick glass or water, which reads what is already drawn behind it.
    Object.assign(G.physicalSurface({ transparent: true }), { transmission: 1 }),
  ];
  const passes = ['exact-clusters', 'clustered-blend', 'shared-blend'];
  const primitives = materials.map((material, index) => {
    const geometry = new G.Geometry();
    geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
    geometry.setIndex(G.indices([0, 1, 2]));
    const mesh = G.mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    source.add(mesh);
    meshes.push(mesh);
    associations.set(mesh, { meshes: index, primitives: 0 });
    return {
      mesh: index,
      primitive: 0,
      pass: passes[index],
      clusterStrategy: 'dag-groups' as const,
      pages: [page(0, `p${index}`, 0)],
      structure: { version: 1, roots: [0], groups: [] },
    };
  });
  source.updateMatrixWorld(true);
  const metadata = {
    errorModel: 'dag-group-qem-v3',
    clusterStrategy: 'dag-groups',
    primitives,
  } as unknown as ClusterManifest;
  const indices = new Map(
    primitives.map((_, index) => [`p${index}`, new Uint32Array([0, 1, 2])] as const),
  );
  return { source, meshes, metadata, indices, associations };
}
