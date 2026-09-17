// C5 : un passage de la coupe qui dépasse le budget de pages s'arrête à la page qui dépasse
// (`pageSelectionCut.ts`) au lieu de mener chaque relance jusqu'au bout avant de la mesurer. La
// référence est l'ancien `sweep()` : une relance complète, rejouée ici en appelant la sélection sans
// budget (`pageBudget` omis désactive le drapeau `over`) et en vérifiant la longueur nous-mêmes,
// exactement ce que faisait la boucle d'avant le lot C. La coupe rendue — pages affichées et
// demandées dans l'ordre, compteurs, seuil final — doit être strictement identique.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSelectionResult, selectVisiblePages } from './pageSelection.ts';
import { dag, racine } from './bench/dagCoupe.mjs';
import { cameraMoteur } from './cameraFixture.ts';

function camera() {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  cam.position.set(0, 0, 9);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

function ask(pixelError: number, pageBudget: number) {
  return {
    pixelError,
    viewport: [1280, 720] as [number, number],
    holdResident: true,
    pageBudget,
    wanted: [] as unknown[],
    result: createSelectionResult(),
  };
}

/** `pageSelectionCut.ts` avant le lot C : chaque relance mène sa descente jusqu'au bout, la longueur
 *  du résultat décide seule si elle est refaite au double du seuil. */
function relanceComplete(
  roots: ReturnType<typeof racine>[],
  cam: THREE.PerspectiveCamera,
  pixelError0: number,
  budget: number,
) {
  let pixelError = pixelError0;
  let result = selectVisiblePages(roots, cameraMoteur(cam), ask(pixelError, 0), []);
  for (let attempt = 0; budget && result.shown.length > budget && attempt < 16; attempt++) {
    pixelError = pixelError > 0 ? pixelError * 2 : 1;
    result = selectVisiblePages(roots, cameraMoteur(cam), ask(pixelError, 0), []);
  }
  return result;
}

function assertSameCut(
  neuf: ReturnType<typeof relanceComplete>,
  ancien: ReturnType<typeof relanceComplete>,
  message: string,
) {
  assert.deepEqual(
    neuf.shown.map((rec) => rec.url),
    ancien.shown.map((rec) => rec.url),
    `${message} : pages affichées`,
  );
  assert.deepEqual(
    neuf.wanted.map((rec) => rec.url),
    ancien.wanted.map((rec) => rec.url),
    `${message} : pages demandées`,
  );
  assert.equal(neuf.frustumRejected, ancien.frustumRejected, `${message} : frustumRejected`);
  assert.equal(neuf.nodesTested, ancien.nodesTested, `${message} : nodesTested`);
  assert.equal(neuf.lodLevel, ancien.lodLevel, `${message} : lodLevel`);
  assert.equal(neuf.complete, ancien.complete, `${message} : complete`);
  assert.ok(Object.is(neuf.pixelError, ancien.pixelError), `${message} : seuil final`);
}

test('un premier passage dépassé d’une seule page converge sur la même coupe que l’ancienne relance', () => {
  const pages = dag({ feuilles: 1024, seed: 5, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  // Premier passage (seuil 50) : 18 pages pour un budget de 17, dépassé d'une seule page.
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(50, 17), []);
  const ancien = relanceComplete(roots, cam, 50, 17);
  assertSameCut(neuf, ancien, 'dépassement de 1');
});

test('un premier passage dépassé d’un ordre de grandeur (10×) converge sur la même coupe', () => {
  const pages = dag({ feuilles: 1024, seed: 5, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  // Premier passage (seuil 1) : 1024 pages pour un budget de 100, dépassé d'un peu plus de 10×.
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(1, 100), []);
  const ancien = relanceComplete(roots, cam, 1, 100);
  assertSameCut(neuf, ancien, 'dépassement de 10×');
});

test('un budget tenu du premier coup ne déclenche aucune relance, des deux côtés', () => {
  const pages = dag({ feuilles: 64, seed: 7, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(1, 1000), []);
  const ancien = relanceComplete(roots, cam, 1, 1000);
  assertSameCut(neuf, ancien, 'budget tenu');
  assert.equal(neuf.pixelError, 1, 'aucun doublement du seuil');
});

test('un budget que même le seuil le plus grossier ne peut tenir refait la coupe entière', () => {
  // Deux racines disjointes : chacune converge vers un unique cluster le plus grossier, donc le
  // minimum atteignable est 2 pages. Un budget de 1 dépasse donc à chaque seuil, jusqu'au dernier.
  const roots = [0, 1].map((i) => racine(dag({ feuilles: 16, seed: 5 + i, residentes: 1 })));
  const cam = camera();
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(1, 1), []);
  const ancien = relanceComplete(roots, cam, 1, 1);
  assertSameCut(neuf, ancien, 'jamais satisfiable');
  assert.equal(neuf.shown.length, 2, 'minimum incompressible des deux racines');
  assert.equal(neuf.pixelError, 65536, 'seize doublements puis la coupe entière au même seuil');
});
