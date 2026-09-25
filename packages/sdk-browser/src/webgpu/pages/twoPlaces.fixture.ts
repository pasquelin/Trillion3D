import * as G from '../../host/graph/graph.fixture.ts';
import { MANIFEST_IDENTITY } from '../../backend/pagesBackend.fixture.ts';
import { QUAD_MANIFEST, triangleGeometry } from '../../backend/pagesBackendScenes.fixture.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createWebgpuPagesRuntime } from './runtime.ts';
import { prepareWebgpuBackend } from './prepare/prepare.ts';
import { disposeWebgpuPages } from './io/metrics.ts';
import { fallbackToCpuCut } from './io/drops.ts';
import { renderWebgpuPages } from './render/render.ts';
import { flushWebgpuPages } from './render/flush.ts';
import { rootPage, twoPrimitives } from './testScenes.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

/** Two meshes twenty units apart, one root cluster each: a camera sees both, or the second only. */
export function twoPlacesScene() {
  const geoA = triangleGeometry([-1, -1, 0, 1, -1, 0, 1, 1, 0]),
    geoB = triangleGeometry([20, -1, 0, 22, -1, 0, 22, 1, 0]);
  const front = G.basicSurface({ color: 0xff0000, side: G.FRONT_SIDE }),
    both = G.basicSurface({ color: 0x00ff00, side: G.DOUBLE_SIDE });
  const meshA = G.mesh(geoA, front),
    meshB = G.mesh(geoB, both),
    source = new G.Group();
  source.add(meshA, meshB);
  const pages = twoPrimitives(
    meshA,
    meshB,
    rootPage('0', [-1, -1, 0], [1, 1, 0]),
    rootPage('1', [20, -1, 0], [22, 1, 0]),
  );
  const dispose = () => [geoA, geoB, front, both].forEach((item) => item.dispose());
  return { source, ...pages, dispose };
}

/** A camera at `(x, 0, z)` looking at `(x, 0, 0)`. */
export function cameraAt(x: number, z: number) {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(x, 0, z);
  cam.lookAt(x, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

/**
 * The two places on a mocked device, prepared, with the CPU cut naming the rows the camera sees (a
 * narrower view moves a page to another row). The wide view is drawn a few images, bounded: both
 * pages are resident at prepare, so the cut settles on two rows.
 */
export async function twoPlacesRuntime() {
  installGpuGlobals();
  const scene = twoPlacesScene();
  const metadata: ClusterManifest = { ...QUAD_MANIFEST, ...scene.metadata, ...MANIFEST_IDENTITY };
  const collected = collectClusterPages(scene.source, metadata, scene.indices, scene.associations);
  const gpu = mockGpu({ packed: packDagSelection(collected.roots) });
  const rt = createWebgpuPagesRuntime({
    ...scene,
    metadata,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  const dispose = () => {
    disposeWebgpuPages(rt);
    scene.dispose();
  };
  try {
    await prepareWebgpuBackend(rt, gpu.device);
    fallbackToCpuCut(rt, 'rows follow the camera');
    const wide = cameraAt(10, 30);
    for (let frame = 0; frame < 4 && rt.layout.rows.packedCount < 2; frame++) {
      renderWebgpuPages(rt, wide);
      await flushWebgpuPages(rt);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { rt, dispose };
}
