import * as THREE from 'three';
import type { ClusterManifest } from '../../packages/sdk-core/index.ts';

/** Four leaves, two mid clusters, one root; the root bundle is pinned, the rest follows. */
export function fixture() {
  const positions: number[] = [];
  for (let t = 0; t < 4; t++) {
    const x = -2 + t;
    positions.push(x, -0.5, 0, x + 1, -0.5, 0, x + 0.5, 0.5, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...Array(12).keys()]);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const leftSphere = [-1, 0, 0, 1.2],
    rightSphere = [1, 0, 0, 1.2],
    rootSphere = [0, 0, 0, 2.3];
  const midError = 0.02,
    rootError = 0.2;
  const leaf = (id: number) => ({
    id,
    url: `leaf${id}`,
    sha256: `leaf${id}`,
    bytes: 12,
    count: 3,
    min: [-2 + id, -0.5, 0],
    max: [-1 + id, 0.5, 0],
    role: 'exact' as const,
    level: 0,
    lodError: 0,
    sphere: [-1.5 + id, 0, 0, 0.6],
    parentError: midError,
    parentSphere: id < 2 ? leftSphere : rightSphere,
    group: id < 2 ? 0 : 1,
    source: null,
    stream: 1,
    streamOffset: id * 12,
  });
  const pages = [
    leaf(0),
    leaf(1),
    leaf(2),
    leaf(3),
    {
      id: 4,
      url: 'mid-left',
      sha256: 'mid-left',
      bytes: 12,
      count: 3,
      min: [-2, -0.5, 0],
      max: [0, 0.5, 0],
      role: 'coarse' as const,
      level: 1,
      lodError: midError,
      sphere: leftSphere,
      parentError: rootError,
      parentSphere: rootSphere,
      group: 2,
      source: 0,
      stream: 2,
      streamOffset: 0,
    },
    {
      id: 5,
      url: 'mid-right',
      sha256: 'mid-right',
      bytes: 12,
      count: 3,
      min: [0, -0.5, 0],
      max: [2, 0.5, 0],
      role: 'coarse' as const,
      level: 1,
      lodError: midError,
      sphere: rightSphere,
      parentError: rootError,
      parentSphere: rootSphere,
      group: 2,
      source: 1,
      stream: 2,
      streamOffset: 12,
    },
    {
      id: 6,
      url: 'root',
      sha256: 'root',
      bytes: 12,
      count: 3,
      min: [-2, -0.5, 0],
      max: [2, 0.5, 0],
      role: 'coarse' as const,
      level: 2,
      lodError: rootError,
      sphere: rootSphere,
      parentError: null,
      parentSphere: null,
      group: null,
      source: 2,
      stream: 0,
      streamOffset: 0,
    },
  ];
  const structure = {
    version: 1,
    roots: [6],
    groups: [
      { level: 1, error: midError, sphere: leftSphere, children: [0, 1], outputs: [4] },
      { level: 1, error: midError, sphere: rightSphere, children: [2, 3], outputs: [5] },
      { level: 2, error: rootError, sphere: rootSphere, children: [4, 5], outputs: [6] },
    ],
  };
  const streams = {
    version: 1,
    pinned: 1,
    bundleBytes: 65536,
    pages: [
      { url: 'bundle-roots', sha256: 'roots', bytes: 12, count: 1 },
      { url: 'bundle-leaves', sha256: 'leaves', bytes: 48, count: 4 },
      { url: 'bundle-mid', sha256: 'mid', bytes: 24, count: 2 },
    ],
  };
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups',
        pages,
        hierarchy: null,
        structure,
        streams,
      },
    ],
  } as unknown as ClusterManifest;
  return {
    geometry,
    material,
    mesh,
    source,
    metadata,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  };
}
export function camera() {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
