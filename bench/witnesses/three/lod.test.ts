import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { threeLodBackend } from './lod.ts';
import { threeMaterials } from './fromGraph.ts';
import { dagLevel } from '../../../packages/sdk-browser/src/backend/pagesBackend.fixture.ts';
import {
  quadCluster,
  fanScene,
  QUAD_MANIFEST,
} from '../../../packages/sdk-browser/src/backend/pagesBackendScenes.fixture.ts';

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
  assert.equal(coarse.material, threeMaterials(material), 'the one copy of the source surface');
  assert.deepEqual(Array.from(coarse.geometry.index!.array), [0, 1, 3, 0, 3, 4]);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
test('THREE.LOD keeps one exact level for source-ordered transparent pages', () => {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
  geometry.setIndex(G.indices([0, 1, 2]));
  const material = G.basicSurface({ transparent: true }),
    mesh = G.mesh(geometry, material),
    source = new G.Group();
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
