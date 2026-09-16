import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hslToLinearRgb, linearToSrgb, srgbToLinear } from './mathColor.ts';
import { assertBits } from './bench/oracles/volumes.mjs';

/** `Color.setHSL` de la référence, dans son espace de travail par défaut (`srgb-linear`) : aucune
 *  courbe de transfert n'y est appliquée, comme `hslToLinearRgb`. */
function colorSetHSL(h: number, s: number, l: number) {
  const c = new THREE.Color().setHSL(h, s, l);
  return [c.r, c.g, c.b];
}

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

// Lot M4a, hslToLinearRgb : `Color.setHSL` de la référence, au bit près, sur une grille dense de
// teintes/saturations/luminosités puis sur les cas hostiles (hors de [0, 1], NaN, infinis).
test('hslToLinearRgb s’accorde avec Color.setHSL au bit près sur une grille dense', () => {
  const out = new Float64Array(3);
  for (let hi = 0; hi <= 12; hi++)
    for (let si = 0; si <= 8; si++)
      for (let li = 0; li <= 8; li++) {
        const h = hi / 12,
          s = si / 8,
          l = li / 8;
        hslToLinearRgb(out, 0, h, s, l);
        assertBits(out, colorSetHSL(h, s, l));
      }
});

test('hslToLinearRgb écrit à partir du décalage `o` donné, sans toucher au reste du tampon', () => {
  const out = new Float64Array(5).fill(-1);
  hslToLinearRgb(out, 1, 0.5, 0.5, 0.5);
  assertBits(out.subarray(1, 4), colorSetHSL(0.5, 0.5, 0.5));
  assert.equal(out[0], -1);
  assert.equal(out[4], -1);
});

test('hslToLinearRgb s’accorde avec Color.setHSL pour une teinte hors de [0, 1], positive ou négative', () => {
  const out = new Float64Array(3);
  for (const h of [-2.5, -1, -0.25, 1.5, 3.75]) {
    hslToLinearRgb(out, 0, h, 0.6, 0.4);
    assertBits(out, colorSetHSL(h, 0.6, 0.4));
  }
});

test('hslToLinearRgb s’accorde avec Color.setHSL quand saturation ou luminosité débordent de [0, 1]', () => {
  const out = new Float64Array(3);
  for (const [s, l] of [
    [-1, 0.5],
    [2, 0.5],
    [0.5, -1],
    [0.5, 2],
    [-3, -3],
    [5, 5],
  ] as const) {
    hslToLinearRgb(out, 0, 0.4, s, l);
    assertBits(out, colorSetHSL(0.4, s, l));
  }
});

test('hslToLinearRgb s’accorde avec Color.setHSL sur NaN et sur les infinis, chaque paramètre à tour de rôle', () => {
  const out = new Float64Array(3);
  const cas: [number, number, number][] = [
    [NaN, 0.5, 0.5],
    [0.4, NaN, 0.5],
    [0.4, 0.5, NaN],
    [Infinity, 0.5, 0.5],
    [-Infinity, 0.5, 0.5],
    [0.4, Infinity, 0.5],
    [0.4, 0.5, Infinity],
    [0.4, 0.5, -Infinity],
  ];
  for (const [h, s, l] of cas) {
    hslToLinearRgb(out, 0, h, s, l);
    assertBits(out, colorSetHSL(h, s, l));
  }
});

test('hslToLinearRgb : saturation nulle rend un gris de la luminosité, comme la référence', () => {
  const out = new Float64Array(3);
  hslToLinearRgb(out, 0, 0.77, 0, 0.33);
  assertBits(out, colorSetHSL(0.77, 0, 0.33));
  assert.equal(out[0], out[1]);
  assert.equal(out[1], out[2]);
});
