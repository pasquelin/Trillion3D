// Lot formules communes : packedRowBase, factorisée de 2 copies (première écriture d'une ligne et
// retassage qui la déplace).
import test from 'node:test';
import assert from 'node:assert/strict';
import { packedRowBase } from './webgpuPageRow.ts';
import { VIS_TRIANGLE_BITS } from './visibilityBuffer.ts';

test('packedRowBase décale le rang de VIS_TRIANGLE_BITS bits, un rang plus loin que le rang', () => {
  assert.equal(packedRowBase(0), 1 << VIS_TRIANGLE_BITS);
  assert.equal(packedRowBase(5), 6 << VIS_TRIANGLE_BITS);
});

test('packedRowBase à la première ligne (rang 0) réserve le zéro pour le fond', () => {
  assert.equal(packedRowBase(0), 256);
  assert.notEqual(packedRowBase(0), 0);
});

test('packedRowBase rend un entier non signé sur 32 bits pour un grand rang', () => {
  const value = packedRowBase(0xffffff);
  assert.ok(Number.isInteger(value) && value >= 0);
  assert.equal(value, ((0xffffff + 1) << VIS_TRIANGLE_BITS) >>> 0);
});
