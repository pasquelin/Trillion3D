import test from 'node:test';
import assert from 'node:assert/strict';
import { linearToSrgb, srgbToLinear } from './mathColor.ts';

test('srgbToLinear : bornes et branche linéaire au seuil 0,04045 inclus', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.equal(srgbToLinear(0.04045), 0.04045 / 12.92);
});

test('linearToSrgb : bornes et branche linéaire au seuil 0,0031308 inclus', () => {
  assert.equal(linearToSrgb(0), 0);
  assert.equal(linearToSrgb(0.0031308), 12.92 * 0.0031308);
});

test('linearToSrgb : sous le seuil, la branche linéaire laisse passer un négatif sans le ramener à zéro', () => {
  // Seul l'exposant (branche au-delà du seuil, où l'entrée est déjà positive) ramène les négatifs à
  // zéro avant `Math.pow` ; la branche linéaire, elle, ne clippe rien.
  assert.equal(linearToSrgb(-0.5), 12.92 * -0.5);
});

test('aller-retour srgbToLinear puis linearToSrgb : identité à 1e-9 près sur tout [0, 1]', () => {
  let pire = 0;
  for (let i = 0; i <= 256; i++) {
    const c = i / 256;
    pire = Math.max(pire, Math.abs(linearToSrgb(srgbToLinear(c)) - c));
  }
  assert.ok(pire < 1e-9, `écart aller-retour ${pire}`);
});
