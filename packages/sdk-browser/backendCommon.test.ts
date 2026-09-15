// Lot formules communes : devicePixels, factorisée de 2 copies (création et redimensionnement du
// canevas). Comportements nominaux et limites, distincts du banc d'équivalence bit à bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { devicePixels, DEFAULT_PIXEL_RATIO } from './backendCommon.ts';

test('devicePixels tronque le produit de la dimension logique et du rapport d’appareil', () => {
  assert.equal(devicePixels(100, 2), 200);
  assert.equal(devicePixels(100, 1.5), 150);
  assert.equal(devicePixels(101, 1.999), 201);
});

test('devicePixels retombe sur le rapport par défaut quand il est absent', () => {
  assert.equal(devicePixels(100, undefined), Math.floor(100 * DEFAULT_PIXEL_RATIO));
});

test('devicePixels rend zéro pour une dimension nulle et tronque vers le bas sur un ratio impair', () => {
  assert.equal(devicePixels(0, 3), 0);
  assert.equal(devicePixels(3, 0.5), 1);
});
