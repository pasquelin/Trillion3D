// Lot F, F12 : `deplaceInstance` (autonomousInstances.ts) lit le couple page/page de base posé une
// fois à la création (`instance.pages[i]` / `instance.bases[i]`) au lieu de reconstruire une table de
// hachage page → page de base à chaque déplacement. L'oracle est la reconstruction d'avant le lot F,
// recopiée telle quelle dans `oracles/cadre-vue.mjs`.
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

test('aucune page ni racine : rien à déplacer, les deux côtés ne touchent à rien', () => {
  memeResultat(new THREE.Matrix4().makeTranslation(5, 5, 5), 0, 0);
});

test('une seule page et une seule racine, transformation identité', () => {
  memeResultat(new THREE.Matrix4(), 1, 1);
});

test('plusieurs pages et racines, transformation composée (rotation + échelle + translation)', () => {
  const transform = new THREE.Matrix4()
    .makeRotationY(Math.PI / 3)
    .scale(new THREE.Vector3(2, 0.5, -1))
    .setPosition(3, -7, 11);
  memeResultat(transform, 8, 3);
});

test('un maillage attaché à la page reçoit lui aussi la même matrice que la référence', () => {
  memeResultat(new THREE.Matrix4().makeTranslation(1, 2, 3), 4, 1, true);
});

test('une transformation dégénérée (échelle nulle) rend la même matrice des deux côtés', () => {
  const transform = new THREE.Matrix4().makeScale(0, 0, 0);
  memeResultat(transform, 3, 2);
});
