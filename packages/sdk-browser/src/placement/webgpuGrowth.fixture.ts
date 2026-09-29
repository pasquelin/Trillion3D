import * as G from '../host/graph/graph.fixture.ts';
import { MANIFEST_IDENTITY } from '../backend/pagesBackend.fixture.ts';
import { dagRoots } from '../webgpu/pages/testDag.fixture.ts';
import { QUAD_MANIFEST, triangleGeometry } from '../backend/pagesBackendScenes.fixture.ts';
import { rootPage } from '../webgpu/pages/testScenes.fixture.ts';
import { cameraAt } from '../webgpu/pages/twoPlaces.fixture.ts';
import type { RowLink } from '../scene/partition/rows.ts';
import { createPlacementRows, growPlacementRows } from './rows.ts';
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
 * Two primitives of one mesh placed by rows, two of them taken at open, drawn by a WebGPU session
 * on a mocked device whose storage binding holds `bindingRows` page-table rows, the CPU cut
 * drawing: the GPU cut lays its catalogue out at open (#483). The session is handed the rows as a
 * world hands them, and told of each one written (`updateWebgpuPlacements`).
 */
export async function placedSession(bindingRows: number) {
  installGpuGlobals();
  const links: RowLink[] = [
    { meshes: 7, primitives: 0, placements: createPlacementRows(2) },
    { meshes: 7, primitives: 1, placements: createPlacementRows(2) },
  ];
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
  /** Takes row `row` of every buffer, at `x` along the ground. */
  const place = (row: number, x: number) => {
    for (const { placements: rows } of links) {
      rows!.matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1], row * 16);
      rows!.live[row] = 1;
      updateWebgpuPlacements(rt, rows!, row, row);
    }
  };
  const reopened = { count: 0 };
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
    place(0, 1);
    place(1, 3);
    await draw();
  } catch (error) {
    dispose();
    throw error;
  }
  return { rt, links, place, draw, reopened, dispose };
}

/** A third row wanted, one more than the buffers hold: they grow in place, as the engine takes it,
 *  and the row is taken; else they stay as they are and the owner is asked to open anew. */
export function growOne({ rt, links, place, reopened }: Awaited<ReturnType<typeof placedSession>>) {
  const from = links.map((link) => link.placements!);
  if (!webgpuGrowsInPlace(rt, from, 4)) return void reopened.count++;
  links.forEach((link, at) => {
    link.placements = growPlacementRows(from[at], 3);
    growWebgpuPlacements(rt, from[at], link.placements);
  });
  place(2, 5);
}
