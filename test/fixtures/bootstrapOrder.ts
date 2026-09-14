import type * as THREE from 'three';
import { dagFixture, wideCamera } from '../../packages/sdk-browser/pageSelectionDagFixture.ts';

type StreamedPage = { id: number; stream: number; streamOffset: number };

/** Four leaves, two mid clusters, one root; the root bundle is pinned, the rest follows. */
export function fixture() {
  const scene = dagFixture();
  const primitive = scene.metadata.primitives[0] as unknown as {
    pages: StreamedPage[];
    streams: unknown;
  };
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
    pages: [
      { url: 'bundle-roots', sha256: 'roots', bytes: 12, count: 1 },
      { url: 'bundle-leaves', sha256: 'leaves', bytes: 48, count: 4 },
      { url: 'bundle-mid', sha256: 'mid', bytes: 24, count: 2 },
    ],
  };
  return { ...scene, material: scene.mesh.material as THREE.Material };
}

export function camera() {
  const cam = wideCamera();
  cam.updateProjectionMatrix();
  return cam;
}
