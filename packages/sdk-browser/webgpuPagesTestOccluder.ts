import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { compareImages } from '../sdk-core/src/index.ts';
import type { PageRec } from './pageSelection.ts';
import { rasterVisibilityIds, shadeVisibility, unpackVisibilityId } from './visibilityBuffer.ts';
import type { webgpuPagesBackend } from './webgpuPages.ts';
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

/** The quad, with its two clusters replaced by a single coarse cluster of the given screen error. */
export function coarseQuadScene(error = 1) {
  const fixture = quadScene();
  const leaves = fixture.metadata.primitives[0].pages;
  const level = dagLevel(leaves, { ...leaves[0], id: 2, url: '2', count: 6, bytes: 24 }, error);
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

/** The GPU image of the occluder scene equals the CPU raster of the cut, and only the front page
 *  survives in the visibility identifiers. */
export function assertOccluderImage(
  backend: ReturnType<typeof webgpuPagesBackend> & {
    rasterRgba(): Uint8Array;
    visibilityIds(): Uint32Array;
  },
  shown: PageRec[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  const cam = readCameraWorld(createEngineCamera(), camera);
  const visPages = shown
    .filter((page) => page.array)
    .map((page) => ({ ...page, array: page.array! }));
  assert.equal(
    compareImages(
      backend.rasterRgba(),
      shadeVisibility(rasterVisibilityIds(visPages, cam, viewport), visPages, cam, viewport),
    ).maxChannelError,
    0,
  );
  const drawn = new Set(
    [...backend.visibilityIds()].flatMap((id) => {
      const unpacked = unpackVisibilityId(id);
      return unpacked ? [unpacked.pageIndex] : [];
    }),
  );
  assert.deepEqual([...drawn].sort(), [0]);
}

/** Two coarse quads a hundred units apart, as two primitives of one source: six clusters that share
 *  the resident slots, so a camera jump between them evicts and recycles rows. */
export function twoCoarseQuadsScene() {
  const a = coarseQuadScene(),
    b = coarseQuadScene();
  const mesh = b.source.children[0] as THREE.Mesh;
  mesh.position.x = 100;
  a.source.add(mesh);
  const primitive = {
    ...b.metadata.primitives[0],
    mesh: 1,
    pages: b.metadata.primitives[0].pages.map((page: { url: string }) => ({
      ...page,
      url: 'b' + page.url,
    })),
  };
  return {
    source: a.source,
    metadata: { primitives: [...a.metadata.primitives, primitive] },
    indices: new Map([
      ...a.indices,
      ...[...b.indices].map(([url, bytes]) => ['b' + url, bytes] as const),
    ]),
    associations: new Map([...a.associations, [mesh, { meshes: 1, primitives: 0 }]]),
    dispose() {
      for (const scene of [a, b]) {
        scene.geometry.dispose();
        scene.material.dispose();
      }
    },
  };
}
