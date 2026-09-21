// A prepared scene of two meshes for the public exact-pages path: one paged opaque quad and,
// in front of it, one transmissive quad the engine keeps as a scene copy of its own.
import * as THREE from 'three';
import type { ClusterManifest, Page, Primitive } from '../../packages/sdk-core/index.ts';
import { quad } from './webglClusterPixels.ts';

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

/** `glass` shapes the transmissive material; the default is plain glass over a red cluster. */
export function transmissionScene(glass: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  const opaque = new THREE.Mesh(quad(-3, 2), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  const copy = new THREE.Mesh(
    quad(-1, 1),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 1, ...glass }),
  );
  const source = new THREE.Group();
  source.add(opaque, copy);
  const primitive = (mesh: THREE.Mesh, primitiveIndex: number, pages: Page[]): Primitive => ({
    mesh: 0,
    primitive: primitiveIndex,
    pass: 'exact-clusters',
    clusterStrategy: 'dag-groups',
    pages,
    structure: { version: 1, roots: pages.map((_, index) => index), groups: [] },
  });
  const primitives = [primitive(opaque, 0, [page]), primitive(copy, 1, [])];
  const metadata: ClusterManifest = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    schema: 1,
    status: 'ready',
    key: 'transmission-scene',
    scope: 'slice',
    sourceTriangles: primitives.length,
    selectedTriangles: primitives.length,
    selectedNodes: [],
    totalNodes: primitives.length,
    primitives,
  };
  return {
    source,
    opaque,
    copy,
    metadata,
    indices: new Map([['quad', new Uint32Array([0, 1, 2, 0, 2, 3])]]),
    associations: new Map<THREE.Object3D, { meshes: number; primitives: number }>([
      [opaque, { meshes: 0, primitives: 0 }],
      [copy, { meshes: 0, primitives: 1 }],
    ]),
    dispose() {
      opaque.geometry.dispose();
      opaque.material.dispose();
      copy.geometry.dispose();
      copy.material.dispose();
    },
  };
}

export function transmissionCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  camera.updateMatrixWorld();
  return camera;
}
