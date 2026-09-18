import * as THREE from 'three';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import type { BackendContext } from './backendTypes.ts';
import { frontCamera, quadIndices, quadScene as quadMesh } from './pagesBackendScenes.ts';

/** The red quad with its two root clusters, as the WebGPU tests hand it to the backend. */
export function quadScene() {
  const { geometry, material, mesh, source } = quadMesh(
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
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
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
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
  options: Partial<BackendContext> = {},
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

export function camera() {
  const cam = frontCamera();
  cam.updateMatrixWorld();
  return cam;
}

export function mixedBinScene() {
  const geoA = new THREE.BufferGeometry();
  geoA.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0], 3),
  );
  geoA.setIndex([0, 1, 2]);
  const geoB = new THREE.BufferGeometry();
  geoB.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geoB.setIndex([0, 1, 2]);
  const front = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.FrontSide }),
    both = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
  const meshA = new THREE.Mesh(geoA, front),
    meshB = new THREE.Mesh(geoB, both),
    source = new THREE.Group();
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
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  pageA: ReturnType<typeof rootPage>,
  pageB: ReturnType<typeof rootPage>,
) {
  const structure = { version: 1, roots: [0], groups: [] };
  const metadata = {
    errorModel: 'dag-group-qem-v1',
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
