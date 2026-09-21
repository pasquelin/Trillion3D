import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { threeLodBackend } from './threeLod.ts';
import { dagLevel } from './pagesBackendFixture.ts';
import { quadCluster, fanScene, QUAD_MANIFEST } from './pagesBackendScenes.ts';

test('THREE.LOD includes transparent simplification and merges its mixed cover in source order', () => {
  const { geometry, material, mesh, source, indices } = fanScene();
  // Clusters 0 and 1 reduce to 3; cluster 2 is never replaced, so the cover is {3, 2} in source order.
  const cluster = quadCluster;
  const primitive = dagLevel([cluster(0, 0), cluster(1, 3)], [cluster(3, 0)], 1, [cluster(2, 6)]);
  const backend = threeLodBackend({
    source,
    metadata: {
      ...QUAD_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'clustered-blend', ...primitive }],
    },
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  const lod = backend.scene.children.find((o) => (o as THREE.LOD).isLOD) as THREE.LOD;
  assert.equal(lod.levels.length, 2);
  assert.equal(backend.capabilities.simplification, true);
  const coarse = lod.levels[1].object as THREE.Mesh;
  assert.equal(coarse.material, material);
  assert.deepEqual(Array.from(coarse.geometry.index!.array), [0, 1, 3, 0, 3, 4]);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
test('THREE.LOD keeps one exact level for source-ordered transparent pages', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshBasicMaterial({ transparent: true }),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const primitive = dagLevel([], [], 1, [quadCluster(0)]);
  const backend = threeLodBackend({
    source,
    metadata: {
      ...QUAD_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'clustered-blend', ...primitive }],
    },
    indices: new Map([['0', new Uint32Array([0, 1, 2])]]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  const lod = backend.scene.children.find((o) => (o as THREE.LOD).isLOD) as THREE.LOD;
  assert.equal(lod.levels.length, 1);
  assert.equal(backend.capabilities.simplification, false);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
