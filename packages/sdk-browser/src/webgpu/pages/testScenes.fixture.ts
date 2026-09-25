import * as G from '../../host/graph/graph.fixture.ts';
import assert from 'node:assert/strict';
import { dagRoots } from './testDag.fixture.ts';
import { webgpuPagesBackend } from './pages.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import {
  QUAD_MANIFEST,
  frontCamera,
  quadIndices,
  quadScene as quadMesh,
  triangleGeometry,
} from '../../backend/pagesBackendScenes.fixture.ts';

/** The red quad with its two root clusters, as the WebGPU tests hand it to the backend. */
export function quadScene() {
  const { geometry, material, mesh, source } = quadMesh(G.basicSurface({ color: 0xff0000 }));
  const pages = dagRoots(
    [0, 1].map((id) => ({
      id,
      url: String(id),
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    })),
  );
  const metadata: ClusterManifest = {
    ...QUAD_MANIFEST,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
      },
    ],
  };
  const indices = quadIndices();
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  return { geometry, material, source, pages, metadata, indices, associations };
}

/**
 * The WebGPU backend mounted on the red quad as the tests want it: two resident pages, a 32 px
 * viewport, and whatever the test adds. The fixture comes back for the test to dispose.
 */
export function quadBackend(
  gpuDevice: BackendContext['gpuDevice'],
  options: Partial<Omit<BackendContext, 'source' | 'metadata' | 'indices' | 'associations'>> = {},
) {
  const fixture = quadScene();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice,
    maxResidentPages: 2,
    viewport: [32, 32],
    ...options,
  });
  return { fixture, backend };
}

/** A pages backend over `scene` that reads its pages on demand: nothing resident at prepare,
 *  three resident slots, a 32 px viewport. */
export function streamingQuadBackend(
  scene: Pick<BackendContext, 'source' | 'metadata' | 'associations'> & {
    indices: Map<string, Uint32Array>;
  },
  gpuDevice: BackendContext['gpuDevice'],
) {
  return webgpuPagesBackend({
    ...scene,
    indices: new Map(),
    readPage: async (url) => scene.indices.get(url)!,
    gpuDevice,
    maxResidentPages: 3,
    viewport: [32, 32],
  });
}

/**
 * `scene` packed for the GPU cut, mounted on a mock GPU that runs it — two resident pages, a
 * 32 px viewport and whatever `options` add — then prepared, rendered once and flushed.
 */
export async function flushedGpuScene(
  scene: Pick<BackendContext, 'source' | 'metadata' | 'indices' | 'associations'>,
  options: Partial<BackendContext> = {},
) {
  const collected = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const packed = packDagSelection(collected.roots);
  const gpu = mockGpu({ packed });
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
    ...options,
  });
  await backend.prepare();
  backend.render(camera());
  await backend.flush?.();
  return { ...gpu, packed, backend };
}

export function camera() {
  const cam = frontCamera();
  cam.updateMatrixWorld();
  return cam;
}

/** Renders the front view: both quad clusters are drawn, two triangles in all. */
export function assertBothQuadPagesDrawn(
  backend: Pick<RenderBackend, 'render' | 'metrics'> & { selectedPageIds(): string[] },
) {
  backend.render(camera());
  assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
  assert.equal(backend.metrics().submittedTriangles, 2);
}

/** Releases a backend and the quad it was mounted on. */
export function disposeQuadRun(
  backend: { dispose(): void },
  fixture: { geometry: G.GraphGeometry; material: G.GraphSurface },
) {
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
}

export function mixedBinScene() {
  const geoA = triangleGeometry([-1, -1, 0, 1, -1, 0, 1, 1, 0]);
  const geoB = triangleGeometry([-1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const front = G.basicSurface({ color: 0xff0000, side: G.FRONT_SIDE }),
    both = G.basicSurface({ color: 0x00ff00, side: G.DOUBLE_SIDE });
  const meshA = G.mesh(geoA, front),
    meshB = G.mesh(geoB, both),
    source = new G.Group();
  source.add(meshA, meshB);
  const box = rootPage('0', [-1, -1, 0], [1, 1, 0]);
  return {
    geoA,
    geoB,
    front,
    both,
    source,
    ...twoPrimitives(meshA, meshB, box, { ...box, url: '1' }),
  };
}

/** One exact root cluster of three indices over the given box. */
export function rootPage(url: string, min: number[], max: number[]) {
  return { id: 0, url, count: 3, min, max, bytes: 12, sha256: 'x' };
}

/** Two primitives, one per mesh, each carrying its own root cluster over the first triangle. */
export function twoPrimitives(
  meshA: G.GraphMesh,
  meshB: G.GraphMesh,
  pageA: ReturnType<typeof rootPage>,
  pageB: ReturnType<typeof rootPage>,
) {
  const structure = { version: 1, roots: [0], groups: [] };
  const metadata = {
    errorModel: 'dag-group-qem-v2',
    clusterStrategy: 'dag-groups',
    primitives: [
      { mesh: 0, primitive: 0, pass: 'exact-clusters', pages: dagRoots([pageA]), structure },
      { mesh: 1, primitive: 0, pass: 'exact-clusters', pages: dagRoots([pageB]), structure },
    ],
  };
  const indices = new Map([
    [pageA.url, new Uint32Array([0, 1, 2])],
    [pageB.url, new Uint32Array([0, 1, 2])],
  ]);
  const associations = new Map([
    [meshA, { meshes: 0, primitives: 0 }],
    [meshB, { meshes: 1, primitives: 0 }],
  ]);
  return { metadata, indices, associations };
}
