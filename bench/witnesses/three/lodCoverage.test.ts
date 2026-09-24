import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { threeLodBackend } from './lod.ts';
import { dagLevel } from '../../../packages/sdk-browser/src/backend/pagesBackend.fixture.ts';
import {
  quadScene,
  quadCluster,
  quadIndices,
  frontCamera,
  QUAD_MANIFEST,
} from '../../../packages/sdk-browser/src/backend/pagesBackendScenes.fixture.ts';

test('THREE.LOD backend exposes one level without coarse pages and two with them', () => {
  const { geometry, material, mesh, source } = quadScene();
  const camera = frontCamera();
  const none = threeLodBackend({
    source,
    metadata: {
      ...QUAD_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages: [] }],
    },
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  none.render(camera);
  assert.equal(none.capabilities.simplification, false);
  assert.equal(none.metrics().clusters, 1);
  none.dispose();
  const cluster = quadCluster;
  const reduced = dagLevel([cluster(0)], [cluster(1)], 1);
  const withLod = threeLodBackend({
    source,
    metadata: {
      ...QUAD_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...reduced }],
    },
    indices: quadIndices(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  withLod.render(camera);
  assert.equal(withLod.capabilities.simplification, true);
  assert.ok((withLod.metrics().selectedTriangles ?? 0) > 0);
  withLod.dispose();
  geometry.dispose();
  material.dispose();
});
test('a far THREE.LOD level keeps the clusters that nothing replaces', () => {
  const { geometry, material, mesh, source } = quadScene();
  // Cluster 0 reduces to 2; cluster 1 is never replaced, so the far level is {2, 1}.
  const cluster = quadCluster;
  const primitive = dagLevel([cluster(0)], [cluster(2)], 1, [cluster(1)]);
  const backend = threeLodBackend({
    source,
    metadata: {
      ...QUAD_MANIFEST,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...primitive }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  const lod = backend.scene.children.find((o) => (o as THREE.LOD).isLOD) as THREE.LOD;
  assert.ok(lod);
  assert.equal(lod.levels.length, 2);
  assert.deepEqual(
    Array.from((lod.levels[0].object as THREE.Mesh).geometry.index!.array),
    [0, 1, 2, 0, 2, 3],
  );
  // The far level is the cover in cluster order: the unreplaced cluster 1, then the reduction 2.
  assert.deepEqual(
    Array.from((lod.levels[1].object as THREE.Mesh).geometry.index!.array),
    [0, 2, 3, 0, 1, 2],
  );
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
