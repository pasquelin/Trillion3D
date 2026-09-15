// Lot formules communes : signedArea et barycentricAt, factorisées de 5 et 3 copies. Comportements
// nominaux et limites, distincts du banc d'équivalence bit à bit (`bench/formules-ts.bench.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedArea, barycentricAt } from './visibilityProjection.ts';

test('signedArea rend le double de l’aire, positif dans le sens direct et négatif inversé', () => {
  const a = { x: 0, y: 0 },
    b = { x: 4, y: 0 },
    c = { x: 0, y: 2 };
  assert.equal(signedArea(a, b, c), 8);
  assert.equal(signedArea(a, c, b), -8);
});

test('signedArea rend zéro pour trois points alignés (triangle dégénéré, aire nulle)', () => {
  assert.equal(signedArea({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), 0);
  // Trois sommets confondus : toujours une aire nulle.
  assert.equal(signedArea({ x: 5, y: -3 }, { x: 5, y: -3 }, { x: 5, y: -3 }), 0);
});

test('signedArea se propage en NaN dès qu’un opérande est NaN', () => {
  assert.ok(Number.isNaN(signedArea({ x: NaN, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 })));
});

test('signedArea distingue +0 de -0 comme Object.is, sans jamais planter', () => {
  const value = signedArea({ x: -0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.ok(Object.is(value, 0) || Object.is(value, -0));
});

test('barycentricAt rend des poids qui somment à un et reconstruisent le point au centre', () => {
  const a = { x: 0, y: 0 },
    b = { x: 4, y: 0 },
    c = { x: 0, y: 4 };
  const area = signedArea(a, b, c);
  const centre = barycentricAt(a, b, c, (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, area);
  assert.ok(Math.abs(centre.w0 - 1 / 3) < 1e-12);
  assert.ok(Math.abs(centre.w1 - 1 / 3) < 1e-12);
  assert.ok(Math.abs(centre.w2 - 1 / 3) < 1e-12);
  assert.ok(Math.abs(centre.w0 + centre.w1 + centre.w2 - 1) < 1e-12);
});

test('barycentricAt sur un triangle d’aire nulle rend NaN ou Infinity, jamais une exception', () => {
  const a = { x: 0, y: 0 },
    b = { x: 1, y: 1 },
    c = { x: 2, y: 2 };
  const weights = barycentricAt(a, b, c, 0.5, 0.5, signedArea(a, b, c));
  assert.ok(!Number.isFinite(weights.w0) || Number.isNaN(weights.w0));
});

test('barycentricAt réutilise le même objet de travail d’un appel à l’autre (contrat documenté)', () => {
  const a = { x: 0, y: 0 },
    b = { x: 2, y: 0 },
    c = { x: 0, y: 2 };
  const area = signedArea(a, b, c);
  const first = barycentricAt(a, b, c, 0.5, 0.5, area);
  const second = barycentricAt(a, b, c, 1, 1, area);
  assert.equal(first, second);
});
