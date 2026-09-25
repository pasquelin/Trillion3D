import type * as G from '../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import {
  dagFixture,
  wideCamera,
} from '../../packages/sdk-browser/src/page/selection/dag.fixture.ts';

/** Four leaves, two mid clusters, one root; the root bundle is pinned, the rest follows. */
export function fixture() {
  const scene = dagFixture();
  const primitive = scene.metadata.primitives[0];
  // Leaves share one bundle, the mid clusters another, and the root is the pinned bundle.
  for (const page of primitive.pages) {
    if (page.id < 4) [page.stream, page.streamOffset] = [1, page.id * 12];
    else if (page.id < 6) [page.stream, page.streamOffset] = [2, (page.id - 4) * 12];
    else [page.stream, page.streamOffset] = [0, 0];
  }
  primitive.streams = {
    version: 1,
    pinned: 1,
    bundleBytes: 65536,
    dependencyBound: 1,
    maxDependencies: 2,
    pages: [
      { url: 'bundle-roots', sha256: 'roots', bytes: 12, count: 1, dependencies: [] },
      { url: 'bundle-leaves', sha256: 'leaves', bytes: 48, count: 4, dependencies: [0, 2] },
      { url: 'bundle-mid', sha256: 'mid', bytes: 24, count: 2, dependencies: [0] },
    ],
  };
  return { ...scene, material: scene.mesh.material as G.GraphSurface };
}

export function camera() {
  const cam = wideCamera();
  cam.updateProjectionMatrix();
  return cam;
}
