// G1: `autonomousGeometry.ts` detaches by the set of pages actually attached (`attachees`,
// a `Set` held by `attach`/`detach`) instead of scanning `allPages` — the whole DAG — at each frame.
// Oracle: the version before batch G, copied as is in `bench/oracles/backend-autonome.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAutonomousGeometry } from './autonomousGeometry.ts';
import { referenceAutonomousSync } from './bench/oracles/backend-autonome.mjs';
import type { PageRec } from './pageSelectionTypes.ts';

function fakeScene() {
  const meshes = new Set<object>();
  return {
    scene: {
      add: (m: object) => meshes.add(m),
      remove: (m: object) => meshes.delete(m),
    } as unknown as THREE.Scene,
    meshes,
  };
}

function makeRec(id: number, triangles: number): PageRec {
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
    material: {} as THREE.Material,
    matrix: new THREE.Matrix4(),
    renderOrder: 0,
    geometry: {} as THREE.BufferGeometry,
    mesh: { matrix: { copy: () => {} } } as unknown as THREE.Mesh,
    attached: false,
  };
}

function environnement(scene: THREE.Scene, allPages: PageRec[], shown: PageRec[]) {
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
        `triangles soumis pour ${JSON.stringify(indices)}`,
      );
      for (let i = 0; i < count; i++)
        assert.equal(
          sceneA.meshes.has(recsA[i].mesh),
          sceneB.meshes.has(recsB[i].mesh),
          `attachement de la page ${i} pour ${JSON.stringify(indices)}`,
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
