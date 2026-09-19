// Batch F, F12: `deplaceInstance` (autonomousInstances.ts) reads the page/base-page pair set
// once at creation (`instance.pages[i]` / `instance.bases[i]`) instead of rebuilding a
// page → base-page hash table on every move. The oracle is the reconstruction from before
// batch F, copied as-is into `oracles/cadre-vue.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deplaceInstance } from './autonomousInstances.ts';
import { referenceUpdateInstance } from './bench/oracles/cadre-vue.mjs';
import type { PageRec, ClusterRoot } from './pageSelection.ts';

function page(matrice: THREE.Matrix4): PageRec {
  return { matrix: matrice, mesh: undefined } as unknown as PageRec;
}
function root(matrice: THREE.Matrix4): ClusterRoot<PageRec> {
  return { world: matrice, pages: [] } as unknown as ClusterRoot<PageRec>;
}

function instanceEtBase(n: number, roots: number) {
  const basePages = Array.from({ length: n }, (_, i) =>
    page(new THREE.Matrix4().makeTranslation(i, 0, 0)),
  );
  const baseRoots = Array.from({ length: roots }, (_, i) =>
    root(new THREE.Matrix4().makeTranslation(0, i, 0)),
  );
  const pages = basePages.map((base) => page(base.matrix.clone()));
  const instRoots = baseRoots.map((r) => root(r.world.clone()));
  return { basePages, baseRoots, pages, instRoots };
}

function memeResultat(transform: THREE.Matrix4, n: number, rootsCount: number, avecMesh = false) {
  const a = instanceEtBase(n, rootsCount);
  const b = instanceEtBase(n, rootsCount);
  if (avecMesh)
    for (let i = 0; i < n; i++) {
      a.pages[i].mesh = { matrix: new THREE.Matrix4() } as unknown as PageRec['mesh'];
      b.pages[i].mesh = { matrix: new THREE.Matrix4() } as unknown as PageRec['mesh'];
    }
  deplaceInstance(
    { pages: a.pages, bases: a.basePages, roots: a.instRoots },
    a.baseRoots,
    transform,
  );
  referenceUpdateInstance(
    { pages: b.pages, roots: b.instRoots },
    b.basePages,
    b.baseRoots,
    transform,
  );
  for (let i = 0; i < n; i++) {
    assert.deepEqual(a.pages[i].matrix.toArray(), b.pages[i].matrix.toArray(), `page ${i}`);
    if (avecMesh)
      assert.deepEqual(
        (a.pages[i].mesh as unknown as { matrix: THREE.Matrix4 }).matrix.toArray(),
        (b.pages[i].mesh as unknown as { matrix: THREE.Matrix4 }).matrix.toArray(),
        `mesh ${i}`,
      );
  }
  for (let i = 0; i < rootsCount; i++)
    assert.deepEqual(a.instRoots[i].world.toArray(), b.instRoots[i].world.toArray(), `root ${i}`);
}

test('no page and no root: nothing to move, neither side touches anything', () => {
  memeResultat(new THREE.Matrix4().makeTranslation(5, 5, 5), 0, 0);
});

test('a single page and a single root, identity transform', () => {
  memeResultat(new THREE.Matrix4(), 1, 1);
});

test('several pages and roots, composed transform (rotation + scale + translation)', () => {
  const transform = new THREE.Matrix4()
    .makeRotationY(Math.PI / 3)
    .scale(new THREE.Vector3(2, 0.5, -1))
    .setPosition(3, -7, 11);
  memeResultat(transform, 8, 3);
});

test('a mesh attached to the page also receives the same matrix as the reference', () => {
  memeResultat(new THREE.Matrix4().makeTranslation(1, 2, 3), 4, 1, true);
});

test('a degenerate transform (zero scale) yields the same matrix on both sides', () => {
  const transform = new THREE.Matrix4().makeScale(0, 0, 0);
  memeResultat(transform, 3, 2);
});
