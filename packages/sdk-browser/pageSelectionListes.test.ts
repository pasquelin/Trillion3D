// Le comportement changé par ce lot : les deux listes de la coupe ne sont plus vidées par
// `length = 0` à chaque image — elles y perdaient leur capacité et la repoussaient de zéro à
// quatre-vingt mille — mais réécrites par indice, leur longueur posée une seule fois à la fin.
// Ce qui doit rester vrai : une coupe plus courte que la précédente ne laisse rien traîner.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { dagCulling } from './pageSelectionTestHelpers.ts';
import { cameraMoteur } from './cameraFixture.ts';

const ASK = { pixelError: 0, viewport: [1280, 720] as [number, number], holdResident: true };

function racines() {
  const fixture = dagFixture();
  fixture.metadata.primitives[0].culling = dagCulling();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return { fixture, roots };
}

/** Une caméra qui ne voit rien du modèle : sa coupe est vide. */
function ailleurs() {
  const cam = new THREE.PerspectiveCamera(20, 16 / 9, 0.1, 1000);
  cam.position.set(1000, 1000, 1000);
  cam.lookAt(2000, 2000, 2000);
  cam.updateMatrixWorld();
  return cam;
}

test('les listes réutilisées ne gardent rien de la coupe précédente, plus courte ou vide', () => {
  const { fixture, roots } = racines();
  const shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const large = selectVisiblePages(roots, cameraMoteur(wideCamera()), { ...ASK, wanted }, shown);
  const pleine = large.shown.length;
  assert.ok(pleine > 0);
  assert.equal(large.wanted.length, pleine);

  const vide = selectVisiblePages(roots, cameraMoteur(ailleurs()), { ...ASK, wanted }, shown);
  assert.equal(vide.shown.length, 0);
  assert.equal(vide.wanted.length, 0);
  assert.equal(shown.length, 0);
  assert.equal(wanted.length, 0);
  // Ni trou ni reste : ce que l'hôte parcourt est exactement la coupe de cette image.
  assert.deepEqual([...shown], []);
  assert.equal(vide.selectedTriangles, 0);
  assert.equal(vide.displayedTriangles, 0);

  // Et la liste repart à sa pleine longueur sans garder de trace du passage à vide.
  const encore = selectVisiblePages(roots, cameraMoteur(wideCamera()), { ...ASK, wanted }, shown);
  assert.equal(encore.shown.length, pleine);
  assert.deepEqual(
    encore.shown.map((page) => page.url),
    large.shown.map((page) => page.url),
  );
  assert.ok(encore.shown.every((page) => page !== undefined));
  fixture.geometry.dispose();
});
