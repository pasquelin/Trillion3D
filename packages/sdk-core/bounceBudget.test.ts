// Lot formules communes : bounceBatchOf, factorisée de 2 copies (passe de sondes et cache de
// surfaces), qui plafonnent toutes deux sur le même arrondi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bounceBatchOf } from './bounceBudget.ts';

test('bounceBatchOf arrondit le produit du plafond et de la charge au plus proche', () => {
  assert.equal(bounceBatchOf(100, 0.5), 50);
  assert.equal(bounceBatchOf(10, 0.34), 3);
  assert.equal(bounceBatchOf(10, 0.36), 4);
});

test('bounceBatchOf ne rend jamais moins de un, même à charge minuscule sur un petit plafond', () => {
  assert.equal(bounceBatchOf(1, 0.01), 1);
  assert.equal(bounceBatchOf(4, 0.05), 1);
  assert.equal(bounceBatchOf(0, 1), 1);
});

test('bounceBatchOf sature au plafond publié quand la charge vaut un', () => {
  assert.equal(bounceBatchOf(256, 1), 256);
});
