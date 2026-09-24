import * as G from '../host/graph/graph.fixture.ts';
import assert from 'node:assert/strict';
import type { BackendContext, RenderBackend } from './types.ts';
import type { ClusterManifest } from '../../../sdk-core/src/index.ts';
import {
  DAG,
  dagRoots,
  dagLevel,
  MANIFEST_IDENTITY,
  type Cluster,
} from './pagesBackend.fixture.ts';

/** One indexed triangle over three `positions`; by default (−1, −1), (1, −1), (0, 1) at z = 0. */
export function triangleGeometry(positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0]) {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute(positions, 3));
  geometry.setIndex(G.indices([0, 1, 2]));
  return geometry;
}

/** The quad's manifest without its primitives: a ready slice of two triangles over the DAG model. */
export const QUAD_MANIFEST: Omit<ClusterManifest, 'primitives'> = {
  ...DAG,
  schema: 1,
  status: 'ready',
  key: 'quad',
  scope: 'slice',
  sourceTriangles: 2,
  selectedTriangles: 2,
  selectedNodes: [],
  totalNodes: 0,
};

/** A unit quad as two triangles: the source most page tests cluster. */
export function quadScene(material: G.GraphSurface = G.basicSurface()) {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]));
  const mesh = G.mesh(geometry, material),
    source = new G.GraphGroup();
  source.add(mesh);
  return { geometry, material, mesh, source };
}

/** One cluster over the whole quad, three indices long. */
export function quadCluster(id: number, start?: number): Cluster {
  return {
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
    ...(start === undefined ? {} : { start }),
  };
}

/** The quad's two triangles as two exact clusters, with the indices each one draws. */
export const quadPages = () => [0, 1].map((id) => quadCluster(id));
export const quadIndices = () =>
  new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
  ]);

/** The camera every page test looks at the quad through. */
export function frontCamera() {
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  return camera;
}

/** A backend context over the quad's two root clusters; `resident` hands the indices over up front. */
export function quadRootsContext(resident: boolean, extra: Partial<BackendContext> = {}) {
  const scene = quadScene();
  const context: BackendContext = {
    source: scene.source,
    metadata: {
      ...QUAD_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(quadPages()) }],
    },
    indices: resident ? quadIndices() : new Map<string, Uint32Array>(),
    associations: new Map([[scene.mesh, { meshes: 0, primitives: 0 }]]),
    ...extra,
  };
  return { ...scene, context };
}

/** Renders the quad from the front and checks the cut collapsed to one coarse cluster. */
export function assertSingleCoarseCluster(
  backend: RenderBackend,
  scene: { geometry: G.GraphGeometry; material: G.GraphSurface },
) {
  backend.render(frontCamera());
  assert.equal(backend.metrics().clusters, 1);
  assert.equal(backend.metrics().selectedTriangles, 1);
  assert.equal(backend.metrics().lodLevel, 1);
  backend.dispose();
  scene.geometry.dispose();
  scene.material.dispose();
}

/** A transparent, double-sided fan of three triangles: clusters 0..2, plus the indices of their
 *  coarse replacements 3 and 4. */
export function fanScene() {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, 0, 0], 3),
  );
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3, 0, 3, 4]));
  const material = G.basicSurface({ transparent: true, side: G.DOUBLE_SIDE }),
    mesh = G.mesh(geometry, material),
    source = new G.GraphGroup();
  source.add(mesh);
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
    ['2', new Uint32Array([0, 3, 4])],
    ['3', new Uint32Array([0, 1, 3])],
    ['4', new Uint32Array([1, 2, 3])],
  ]);
  return { geometry, material, mesh, source, indices };
}

/** The quad with two clusters replaced by one coarser cluster whose screen error clears a 10 px
 *  budget, as a backend context at `pixelError`; the scene comes back with it. */
export function coarseQuadContext(pixelError: number) {
  const scene = quadScene();
  const level = dagLevel([quadCluster(0), quadCluster(1)], [quadCluster(2)], 0.001);
  const context = {
    source: scene.source,
    metadata: {
      ...DAG,
      ...MANIFEST_IDENTITY,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...level }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
    ]),
    associations: new Map([[scene.mesh, { meshes: 0, primitives: 0 }]]),
    pixelError,
    viewport: [960, 540] as [number, number],
  };
  return { ...scene, context };
}
