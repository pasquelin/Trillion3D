// G1: `geometry.ts` detaches by the set of pages actually attached (`attachees`,
// a `Set` held by `attach`/`detach`) instead of scanning `allPages` — the whole DAG — at each frame.
// Oracle: the version before batch G, copied as is in `../../../../../bench/oracles/browser/autonomous-backend.ts`.
import type { GraphScene } from '../../host/graph/scene.ts';
import type { GraphMesh } from '../../host/graph/mesh.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAutonomousGeometry } from './geometry.ts';
import { referenceAutonomousSync } from '../../../../../bench/oracles/browser/autonomous-backend.ts';
import type { PageRec } from '../../page/selection/types.ts';
import { surfaceOf } from '../../page/surface.ts';

function fakeScene() {
  const meshes = new Set<object>();
  return {
    scene: {
      add: (m: object) => meshes.add(m),
      remove: (m: object) => meshes.delete(m),
    } as unknown as GraphScene,
    meshes,
  };
}

function makeRec(id: number, triangles: number): PageRec & { mesh: GraphMesh } {
  return {
    id,
    url: `u${id}`,
    clusterId: `c${id}`,
    array: new Uint32Array([0, 1, 2]),
    triangles,
    indexBytes: 12,
    min: [0, 0, 0],
    max: [1, 1, 1],
    depthLayer: 0,
    attributes: {} as THREE.BufferGeometry['attributes'],
    material: surfaceOf({} as unknown as THREE.Material),
    declaration: {} as THREE.Material,
    matrix: new THREE.Matrix4(),
    renderOrder: 0,
    geometry: {} as THREE.BufferGeometry,
    // The oracle copies a host matrix; the engine reads the sixteen floats of the contract.
    mesh: { matrix: { copy: () => {}, fromArray: () => {} } } as unknown as GraphMesh,
    attached: false,
  };
}

function environnement(
  scene: GraphScene,
  allPages: PageRec[],
  shown: PageRec[],
): Parameters<typeof createAutonomousGeometry>[0] {
  return {
    scene,
    allPages,
    bootstrap: [],
    shown,
    desired: [],
    byUrl: new Map(),
    descriptors: new Map(),
    baseMaterials: new Map(),
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  };
}

/** Two sets of identical pages (same id, triangles), one for optimized implementation, one
 *  for the oracle: each `pilot` call moves both forward with the same list of pages
 *  displayed, then compare the attached set of the scene and the number of triangles submitted. */
function scenario(count: number) {
  const recsA = Array.from({ length: count }, (_, i) => makeRec(i, (i % 7) + 1));
  const recsB = Array.from({ length: count }, (_, i) => makeRec(i, (i % 7) + 1));
  const sceneA = fakeScene(),
    sceneB = fakeScene();
  const shownA: PageRec[] = [],
    shownB: PageRec[] = [];
  const impl = createAutonomousGeometry(environnement(sceneA.scene, recsA, shownA));
  const oracle = referenceAutonomousSync({ scene: sceneB.scene, allPages: recsB, shown: shownB });
  return {
    pilote(indices: number[]) {
      shownA.length = 0;
      shownB.length = 0;
      for (const i of indices) {
        shownA.push(recsA[i]);
        shownB.push(recsB[i]);
      }
      impl.sync();
      oracle.sync();
      assert.equal(
        impl.state.submittedTriangles,
        oracle.state.submittedTriangles,
        `triangles submitted for ${JSON.stringify(indices)}`,
      );
      for (let i = 0; i < count; i++)
        assert.equal(
          sceneA.meshes.has(recsA[i].mesh),
          sceneB.meshes.has(recsB[i].mesh),
          `attachment of page ${i} for ${JSON.stringify(indices)}`,
        );
      assert.equal(sceneA.meshes.size, sceneB.meshes.size);
    },
  };
}

test('empty scene, empty cut: nothing to attach or detach on either side', () => {
  scenario(0).pilote([]);
});

test('an empty cut when everything was attached detaches everything, identically to the oracle', () => {
  const s = scenario(6);
  s.pilote([0, 1, 2, 3, 4, 5]);
  s.pilote([]);
});

test('a cut that grows and then shrinks in jerks remains the same image after image', () => {
  const s = scenario(10);
  s.pilote([0, 1, 2]);
  s.pilote([0, 1, 2, 3, 4, 5, 6]);
  s.pilote([3, 4, 5, 6]);
  s.pilote([9]);
  s.pilote([]);
  s.pilote([0, 9]);
});

test('duplicates in the displayed cut count triangles twice, on both sides', () => {
  const s = scenario(4);
  s.pilote([0, 0, 1, 1, 1, 2]);
  s.pilote([2, 2]);
});

test('a page with zero triangles attaches without distorting the sum', () => {
  const s = scenario(3);
  s.pilote([0]);
  s.pilote([0, 1]);
});

test('a large DAG with random churn matches the oracle exactly, cut after cut', () => {
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = 400;
  const s = scenario(count);
  for (let frame = 0; frame < 40; frame++) {
    const indices: number[] = [];
    for (let i = 0; i < count; i++) if (rand() < 0.15) indices.push(i);
    s.pilote(indices);
  }
  s.pilote([]);
});

// #297: `attach` mounts the host declaration the page was collected from, never the engine's own
// surface record. A record carries no `visible`, and the host library drops every mesh whose
// material lacks one: 430 meshes attached, 430 draw calls, zero triangle on screen.
test('an attached page wears the host declaration, not the engine surface record', () => {
  const { scene, meshes } = fakeScene();
  const declaration = new THREE.MeshStandardMaterial();
  const rec: PageRec = {
    ...makeRec(0, 1),
    geometry: new THREE.BufferGeometry() as PageRec['geometry'],
    mesh: undefined,
    declaration,
    material: surfaceOf(declaration),
  };
  const shown = [rec];
  createAutonomousGeometry(environnement(scene, [rec], shown)).sync();
  const [attached] = [...meshes] as GraphMesh[];
  assert.equal(attached.material, declaration);
  assert.equal((attached.material as THREE.Material).visible, true);
  declaration.dispose();
});

test('the store keeps a page by page, checked against the catalogue even when nothing draws it', () => {
  const { scene } = fakeScene();
  const material = new THREE.MeshStandardMaterial();
  const empty = { url: 'p.bin', array: undefined, geometry: undefined };
  const recs = [0, 1].map((id) => ({ ...makeRec(id, 1), ...empty }));
  const env = environnement(scene, recs, []);
  const descriptor = { vertexCount: 3, indexCount: 3, flags: 0 } as never;
  env.byUrl.set('p.bin', recs).set('empty.bin', []);
  env.descriptors.set('p.bin', descriptor).set('empty.bin', descriptor);
  for (const rec of recs) env.baseMaterials.set(rec, material);
  env.modifiedPages.add('replaced.bin');
  const store = createAutonomousGeometry(env);
  const page = () => ({
    ...{ indices: new Uint32Array([0, 1, 2]), vertexCount: 3, flags: 0, decodedBytes: 48 },
    ...{ attributes: { position: new Float32Array(9) }, quantizationError: 0 },
  });
  assert.equal(store.acceptGeometryPage('replaced.bin', page()), false, 'the host replaced it');
  assert.equal(store.acceptGeometryPage('unknown.bin', page()), false);
  const wrong = { ...page(), vertexCount: 4 };
  assert.throws(() => store.storeGeometryPage('empty.bin', wrong), /METADATA_MISMATCH/);
  assert.equal(store.storeGeometryPage('empty.bin', page()), false, 'no record draws it');
  assert.equal(store.storeGeometryPage('p.bin', page()), true);
  assert.equal(store.storeGeometryPage('p.bin', page()), true);
  assert.equal(store.state.residentPages, 1, 'one page, two records, stored twice');
  assert.deepEqual([store.releasePage('p.bin'), store.releasePage('p.bin')], [true, false]);
  assert.equal(store.state.residentPages, 0, 'the page, not its two records, left');
  store.dispose();
  material.dispose();
});
