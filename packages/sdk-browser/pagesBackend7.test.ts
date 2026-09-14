import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages } from './pageSelection.ts';
import { dagRoots, DAG } from './pagesBackendFixture.ts';

test('transmissive materials stay as unsplit source meshes even when the cache pass is exact-clusters', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshPhysicalMaterial({
    transmission: 1,
    thickness: 0.02,
    roughness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const pages = [
    { id: 0, url: '0', count: 3, min: [-1, -1, 0], max: [1, 1, 0], bytes: 12, sha256: 'x' },
  ];
  const collected = collectClusterPages(
    source,
    { ...DAG, primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }] },
    new Map([['0', new Uint32Array([0, 1, 2])]]),
    new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  );
  assert.equal(collected.allPages.length, 0);
  assert.equal(collected.blendCopies.length, 1);
  assert.equal(collected.blendCopies[0].material, material);
  geometry.dispose();
  material.dispose();
});
