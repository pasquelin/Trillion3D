import * as THREE from 'three';
import { dagLevel, dagRoots } from './webgpuPagesTestDag.ts';
import { quadScene } from './webgpuPagesTestScenes.ts';

export function occluderScene() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -0.2, -0.2, -2, 0.2, -0.2, -2, 0.2, 0.2, -2, -0.2,
        0.2, -2,
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const pages = dagRoots([
    {
      id: 0,
      url: 'front',
      count: 6,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 24,
      sha256: 'x',
    },
    {
      id: 1,
      url: 'back',
      count: 6,
      min: [-0.2, -0.2, -2] as number[],
      max: [0.2, 0.2, -2] as number[],
      bytes: 24,
      sha256: 'x',
    },
  ]);
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
    ['front', new Uint32Array([0, 1, 2, 0, 2, 3])],
    ['back', new Uint32Array([4, 5, 6, 4, 6, 7])],
  ]);
  const associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  return { geometry, material, source, metadata, indices, associations };
}

/** The quad, with its two clusters replaced by a single coarse cluster of screen error 1. */
export function coarseQuadScene() {
  const fixture = quadScene();
  const leaves = fixture.metadata.primitives[0].pages;
  const level = dagLevel(leaves, { ...leaves[0], id: 2, url: '2', count: 6, bytes: 24 }, 1);
  return {
    ...fixture,
    metadata: {
      ...fixture.metadata,
      primitives: [{ ...fixture.metadata.primitives[0], ...level }],
    },
    indices: new Map([...fixture.indices, ['2', new Uint32Array([0, 1, 2, 0, 2, 3])]] as [
      string,
      Uint32Array,
    ][]),
  };
}
