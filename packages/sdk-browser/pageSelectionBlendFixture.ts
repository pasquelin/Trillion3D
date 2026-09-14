import * as THREE from 'three';
import type { ClusterManifest } from '../sdk-core/index.ts';

export function blendFixture(
  material: THREE.Material = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
  }),
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 0, 1, 0, 99, -1, 0, 101, -1, 0, 100, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  // Two level-0 clusters that nothing replaces: the smallest legal DAG, so both are root clusters.
  const pages = [
    {
      id: 0,
      url: 'near',
      count: 3,
      bytes: 12,
      sha256: 'near',
      min: [-1, -1, 0],
      max: [1, 1, 0],
      role: 'exact' as const,
      start: 0,
      level: 0,
      lodError: 0,
      sphere: [0, 0, 0, 1.5],
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
    },
    {
      id: 1,
      url: 'far',
      count: 3,
      bytes: 12,
      sha256: 'far',
      min: [99, -1, 0],
      max: [101, 1, 0],
      role: 'exact' as const,
      start: 3,
      level: 0,
      lodError: 0,
      sphere: [100, 0, 0, 1.5],
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
    },
  ];
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'clustered-blend',
        clusterStrategy: 'dag-groups' as const,
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
      },
    ],
  } as unknown as ClusterManifest;
  const indices = new Map([
    ['near', new Uint32Array([0, 1, 2])],
    ['far', new Uint32Array([3, 4, 5])],
  ]);
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  return { geometry, material, mesh, source, metadata, indices, associations };
}

export function camera() {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}
