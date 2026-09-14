import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { threeLodBackend } from './threeLod.ts';
import { DAG, dag } from '../../test/fixtures/threeLod.ts';

test('THREE.LOD includes transparent simplification and merges its mixed cover in source order', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, 0, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  // Clusters 0 and 1 reduce to 3; cluster 2 is never replaced, so the cover is {3, 2} in source order.
  const cluster = (id: number, start: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
    start,
  });
  const primitive = dag([cluster(0, 0), cluster(1, 3)], [cluster(3, 0)], [cluster(2, 6)]);
  const backend = threeLodBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'clustered-blend', ...primitive }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 3, 4])],
      ['3', new Uint32Array([0, 1, 3])],
    ]),
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
  const primitive = dag(
    [],
    [],
    [{ id: 0, url: '0', count: 3, min: [-1, -1, 0], max: [1, 1, 0], bytes: 12, sha256: 'x' }],
  );
  const backend = threeLodBackend({
    source,
    metadata: {
      ...DAG,
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
