// Lot H2 : le contrat pur du décodage hors fil — aucune plateforme ici, seulement la forme des
// refus et la borne du pool. Entrées hostiles : messages inconnus, tailles absentes ou non entières.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_DECODE_FAILURES,
  pageDecodeFailureCode,
  pageDecodeWorkerCount,
} from './pageDecodeContracts.ts';

test('chaque refus nommé de la liste close se retrouve lui-même', () => {
  for (const code of PAGE_DECODE_FAILURES) assert.equal(pageDecodeFailureCode(code), code);
});

test('un message inconnu ou vide retombe sur PAGE_DECODE_FAILED', () => {
  assert.equal(pageDecodeFailureCode('boom'), 'PAGE_DECODE_FAILED');
  assert.equal(pageDecodeFailureCode(''), 'PAGE_DECODE_FAILED');
  assert.equal(pageDecodeFailureCode('geometry_page_header'), 'PAGE_DECODE_FAILED'); // casse différente
});

test('la borne du pool retient le plus petit des cœurs, du plafond et de l’admission', () => {
  assert.equal(pageDecodeWorkerCount(8, 6), 4); // plafond par défaut (4) le plus serré
  assert.equal(pageDecodeWorkerCount(8, 2), 2); // admission la plus serrée
  assert.equal(pageDecodeWorkerCount(1, 10), 1); // cœurs le plus serré
  assert.equal(pageDecodeWorkerCount(10, 10, 2), 2); // plafond explicite le plus serré
});

test('des cœurs absents ou non entiers valent un seul exécutant', () => {
  assert.equal(pageDecodeWorkerCount(undefined, 10), 1);
  assert.equal(pageDecodeWorkerCount(Number.NaN, 10), 1);
  assert.equal(pageDecodeWorkerCount(3.5, 10), 1);
  assert.equal(pageDecodeWorkerCount(Number.POSITIVE_INFINITY, 10), 1);
});

test('une admission absente ou non entière vaut un seul exécutant admis', () => {
  assert.equal(pageDecodeWorkerCount(8, undefined as unknown as number), 1);
  assert.equal(pageDecodeWorkerCount(8, Number.NaN), 1);
  assert.equal(pageDecodeWorkerCount(8, 2.9), 1);
});

test('la borne ne descend jamais sous un seul exécutant, même à zéro ou en négatif', () => {
  assert.equal(pageDecodeWorkerCount(8, 0), 1);
  assert.equal(pageDecodeWorkerCount(0, 10), 1);
  assert.equal(pageDecodeWorkerCount(8, -5), 1);
});
