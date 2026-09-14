import * as THREE from 'three';
import { dagRoots } from './webgpuPagesTestDag.ts';

export function quadScene() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
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
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
  ]);
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  return { geometry, material, source, pages, metadata, indices, associations };
}

export function camera() {
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  cam.position.z = 5;
  cam.lookAt(0, 0, 0);
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
  const pagesA = dagRoots([
    {
      id: 0,
      url: '0',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
  ]);
  const pagesB = dagRoots([
    {
      id: 0,
      url: '1',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
  ]);
  const structure = { version: 1, roots: [0], groups: [] };
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      { mesh: 0, primitive: 0, pass: 'exact-clusters', pages: pagesA, structure },
      { mesh: 1, primitive: 0, pass: 'exact-clusters', pages: pagesB, structure },
    ],
  };
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 1, 2])],
  ]);
  const associations = new Map([
    [meshA, { meshes: 0, primitives: 0 }],
    [meshB, { meshes: 1, primitives: 0 }],
  ]);
  return { geoA, geoB, front, both, source, metadata, indices, associations };
}
