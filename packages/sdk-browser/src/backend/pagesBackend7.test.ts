import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ClusterManifest } from '../../../sdk-core/src/index.ts';
import { collectClusterPages } from '../page/selection/selection.ts';
import { asHostLibrary } from '../host/resources.ts';
import { createBlendCopy } from '../cluster/blendCopyMesh.ts';
import { dagRoots, DAG } from './pagesBackend.fixture.ts';

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
  const manifest: ClusterManifest = {
    ...DAG,
    schema: 1,
    status: 'ready',
    key: 'k',
    scope: 'full',
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: [],
    totalNodes: 0,
    primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
  };
  const indices = new Map([['0', new Uint32Array([0, 1, 2])]]),
    associations = new Map([[mesh, { meshes: 0, primitives: 0 }]]);
  const collected = collectClusterPages(source, manifest, indices, associations);
  assert.equal(collected.allPages.length, 0);
  assert.equal(collected.blendCopies.length, 1);
  // The collection hands out the ENGINE's own record: the geometry and the surface record of the
  // source mesh, and the mesh itself only as the identity the record stands for.
  const record = collected.blendCopies[0];
  assert.equal(record.geometry, geometry);
  assert.equal(record.userData.sourceMesh, mesh);
  assert.equal(record.surface.transmission, 1);
  // A witness that draws its transparent surfaces with a host renderer asks for host meshes, and
  // the host material stays on the copy for that renderer (`../cluster/blendCopyMesh.ts`).
  const witness = collectClusterPages(source, manifest, indices, associations, {
    blendCopy: createBlendCopy,
  });
  assert.equal(asHostLibrary<THREE.Mesh>(witness.blendCopies[0]).material, material);
  geometry.dispose();
  material.dispose();
});
