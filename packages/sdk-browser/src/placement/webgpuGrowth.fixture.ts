import * as G from '../host/graph/graph.fixture.ts';
import { MANIFEST_IDENTITY } from '../backend/pagesBackend.fixture.ts';
import { dagRoots } from '../webgpu/pages/testDag.fixture.ts';
import { QUAD_MANIFEST, triangleGeometry } from '../backend/pagesBackendScenes.fixture.ts';
import { rootPage } from '../webgpu/pages/testScenes.fixture.ts';
import { cameraAt } from '../webgpu/pages/twoPlaces.fixture.ts';
import { world } from '../scene/partition/cells.fixture.ts';
import type { PartitionCells } from '../scene/partition/cells.ts';
import type { RowLink } from '../scene/partition/rows.ts';
import { collectClusterPages } from '../page/selection/selection.ts';
import { packDagSelection } from '../gpu/dag/selection.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { createWebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { prepareWebgpuBackend } from '../webgpu/pages/prepare/prepare.ts';
import { disposeWebgpuPages } from '../webgpu/pages/io/metrics.ts';
import { fallbackToCpuCut } from '../webgpu/pages/io/drops.ts';
import { renderWebgpuPages } from '../webgpu/pages/render/render.ts';
import { flushWebgpuPages } from '../webgpu/pages/render/flush.ts';
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts';
import { updateWebgpuPlacements } from './webgpuPlacements.ts';
import { growWebgpuPlacements, webgpuGrowsInPlace } from './webgpuGrowth.ts';
import type { ClusterManifest } from '../../../sdk-core/src/index.ts';

type Io = Parameters<PartitionCells['frame']>[2];
/** No arrival budget: what a test places never depends on the time the machine takes. */
const noBudget = { admits: () => true, spend() {} };

/** A ground triangle, and the two primitives of the mesh the partition places (`cells.fixture`),
 *  each a triangle of one root cluster, on the rows of `links`. */
function placedScene(links: readonly RowLink[]) {
  const geometries = [0, 1, 2].map(() => triangleGeometry());
  const surface = G.basicSurface({ color: 0xff0000, side: G.DOUBLE_SIDE });
  const [ground, ...leaves] = geometries.map((geometry) => G.mesh(geometry, surface));
  const source = new G.Group();
  source.add(ground, ...leaves);
  const structure = { version: 1, roots: [0], groups: [] };
  const primitive = (mesh: number, rank: number, url: string) => ({
    mesh,
    primitive: rank,
    pass: 'exact-clusters',
    pages: dagRoots([rootPage(url, [-1, -1, 0], [1, 1, 0])]),
    structure,
  });
  const metadata: ClusterManifest = {
    ...QUAD_MANIFEST,
    primitives: [primitive(0, 0, 'ground'), primitive(7, 0, 'leaf-0'), primitive(7, 1, 'leaf-1')],
    ...MANIFEST_IDENTITY,
  };
  const indices = new Map(
    ['ground', 'leaf-0', 'leaf-1'].map((url) => [url, new Uint32Array([0, 1, 2])]),
  );
  const associations = new Map<G.HostMesh, RowLink>([
    [ground, { meshes: 0, primitives: 0 }],
    [leaves[0], links[0]],
    [leaves[1], links[1]],
  ]);
  const dispose = () => [...geometries, surface].forEach((item) => item.dispose());
  return { source, metadata, indices, associations, dispose };
}

/**
 * The partition of `cells.fixture` — its near cell's two nodes on rows sized at open, its far one
 * five kilometres off under the same core node — drawn by a WebGPU session on a mocked device
 * whose storage binding holds `bindingRows` page-table rows, the CPU cut drawing: the GPU cut lays
 * its catalogue out at open (#483).
 * The session is handed the partition's rows as a world hands them (`partitionFrame.ts`).
 */
export async function placedSession(bindingRows: number) {
  installGpuGlobals();
  const partition = world(0, 0);
  const { cells, links, bytes } = partition;
  await cells.prime([1e9, 0, 0], 100, () => Promise.reject(new Error('nothing is read')), true);
  const scene = placedScene(links);
  const collected = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const binding = bindingRows * PAGE_INFO_STRIDE;
  const gpu = mockGpu({
    packed: packDagSelection(collected.roots),
    limits: { maxBufferSize: Math.max(1 << 20, binding), maxStorageBufferBindingSize: binding },
  });
  const rt = createWebgpuPagesRuntime({
    ...scene,
    gpuDevice: gpu.device,
    maxResidentPages: 3,
    viewport: [32, 32],
  });
  const reopened = { count: 0 };
  const io: Io = {
    bytes,
    loading: () => false,
    request() {},
    update: (rows, from, to) => updateWebgpuPlacements(rt, rows, from, to),
    grow: {
      growsInPlace: (from) => webgpuGrowsInPlace(rt, from),
      growPlacements: (from, to) => growWebgpuPlacements(rt, from, to),
    },
    outgrown: () => void reopened.count++,
  };
  const view = cameraAt(0, 30);
  const draw = async () => {
    renderWebgpuPages(rt, view);
    await flushWebgpuPages(rt);
  };
  const dispose = () => {
    disposeWebgpuPages(rt);
    scene.dispose();
  };
  try {
    await prepareWebgpuBackend(rt, gpu.device);
    fallbackToCpuCut(rt, 'rows follow the camera');
    cells.frame([0, 0, 0], 100, io, noBudget);
    await draw();
  } catch (error) {
    dispose();
    throw error;
  }
  return { rt, ...partition, io, draw, reopened, dispose };
}

/** Shrinks the core node a thousand times: the far cell comes within reach, one more node than
 *  the rows hold. Two frames, as a world runs them. */
export function scaleDown({ cells, core, io }: Awaited<ReturnType<typeof placedSession>>) {
  core.scale.set(1e-3, 1e-3, 1e-3);
  cells.frame([0, 0, 0], 100, io, noBudget);
  cells.frame([0, 0, 0], 100, io, noBudget);
}
