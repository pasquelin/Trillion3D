// A prepared scene for the public exact-pages path: one paged opaque quad, in front of it one
// transmissive quad, and a small blended quad in front of both, off centre — the two scene
// copies the engine draws itself, transmissive then blended.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { quad } from './webglClusterPixels.ts';
import type { Page } from '../../../packages/sdk-core/src/index.ts';

const page: Page = {
  id: 0,
  url: 'quad',
  count: 6,
  bytes: 24,
  sha256: 'quad',
  min: [-2, -2, -3],
  max: [2, 2, -3],
  role: 'exact',
  start: 0,
  level: 0,
  lodError: 0,
  sphere: [0, 0, -3, 3],
  parentError: null,
  parentSphere: null,
  group: null,
  source: null,
};

/** `glass` shapes the transmissive material; the default is plain glass over a red cluster.
 *  The half-transparent blue quad sits at pixel (55, 32) of a 64 × 64 view. */
export function transmissionScene(glass = {}) {
  const opaque = G.mesh(quad(-3, 2), G.basicSurface({ color: 0xff0000 }));
  const copy = G.mesh(
    quad(-1, 1),
    G.physicalSurface({ color: 0xffffff, transmission: 1, roughness: 1, ...glass }),
  );
  const blend = G.mesh(
    quad(-0.5, 0.06),
    G.basicSurface({ color: 0x0000ff, transparent: true, opacity: 0.5 }),
  );
  blend.position.x = 0.21;
  const source = new G.GraphGroup();
  source.add(opaque, copy, blend);
  const primitive = (mesh: G.GraphMesh, primitiveIndex: number, pages: (typeof page)[]) => ({
    mesh: 0,
    primitive: primitiveIndex,
    pass: 'exact-clusters' as const,
    clusterStrategy: 'dag-groups' as const,
    pages,
    structure: { version: 1, roots: pages.map((_, index) => index), groups: [] },
  });
  return {
    source,
    opaque,
    copy,
    metadata: {
      schema: 1,
      status: 'ready',
      key: 'transmission',
      scope: 'full' as const,
      sourceTriangles: 6,
      selectedTriangles: 6,
      selectedNodes: 0,
      totalNodes: 3,
      errorModel: 'dag-group-qem-v1',
      clusterStrategy: 'dag-groups',
      primitives: [
        primitive(opaque, 0, [page]),
        primitive(copy, 1, []),
        { ...primitive(blend, 2, []), pass: 'shared-blend' as const },
      ],
    },
    indices: new Map([['quad', new Uint32Array([0, 1, 2, 0, 2, 3])]]),
    associations: new Map<G.GraphNode, { meshes: number; primitives: number }>([
      [opaque, { meshes: 0, primitives: 0 }],
      [copy, { meshes: 0, primitives: 1 }],
      [blend, { meshes: 0, primitives: 2 }],
    ]),
    dispose() {
      for (const mesh of [opaque, copy, blend]) {
        mesh.geometry.dispose();
        (mesh.material as G.GraphSurface).dispose();
      }
    },
  };
}

export function transmissionCamera() {
  const camera = G.perspectiveCamera(60, 1, 0.1, 10);
  camera.updateMatrixWorld();
  return camera;
}
