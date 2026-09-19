import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hslToLinearRgb, linearToSrgb, srgbToLinear } from './mathColor.ts';
import { assertBits } from './bench/oracles/volumes.mjs';

/** Reference `Color.setHSL`, in its default working space (`srgb-linear`): no
 *  transfer curve is applied there, like `hslToLinearRgb`. */
function colorSetHSL(h: number, s: number, l: number) {
  const c = new THREE.Color().setHSL(h, s, l);
  return [c.r, c.g, c.b];
}

test('srgbToLinear: bounds and linear branch at the 0.04045 threshold inclusive', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.equal(srgbToLinear(0.04045), 0.04045 / 12.92);
});

test('linearToSrgb: bounds and linear branch at the 0.0031308 threshold inclusive', () => {
  assert.equal(linearToSrgb(0), 0);
  assert.equal(linearToSrgb(0.0031308), 12.92 * 0.0031308);
});

test('linearToSrgb: below the threshold, the linear branch lets a negative through without clamping to zero', () => {
  // Only the exponent (branch beyond the threshold, where the input is already positive) clamps
  // negatives to zero before `Math.pow`; the linear branch clips nothing.
  assert.equal(linearToSrgb(-0.5), 12.92 * -0.5);
});

test('round-trip srgbToLinear then linearToSrgb: identity within 1e-9 over all of [0, 1]', () => {
  let pire = 0;
  for (let i = 0; i <= 256; i++) {
    const c = i / 256;
    pire = Math.max(pire, Math.abs(linearToSrgb(srgbToLinear(c)) - c));
  }
  assert.ok(pire < 1e-9, `round-trip discrepancy ${pire}`);
});

// Batch M4a, hslToLinearRgb: reference `Color.setHSL`, bit-exact, on a dense grid of
// hues/saturations/lightness then on hostile cases (outside [0, 1], NaN, infinities).
test('hslToLinearRgb matches Color.setHSL bit-exact on a dense grid', () => {
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

test('hslToLinearRgb writes from the given offset `o`, without touching the rest of the buffer', () => {
  const out = new Float64Array(5).fill(-1);
  hslToLinearRgb(out, 1, 0.5, 0.5, 0.5);
  assertBits(out.subarray(1, 4), colorSetHSL(0.5, 0.5, 0.5));
  assert.equal(out[0], -1);
  assert.equal(out[4], -1);
});

test('hslToLinearRgb matches Color.setHSL for a hue outside [0, 1], positive or negative', () => {
  const out = new Float64Array(3);
  for (const h of [-2.5, -1, -0.25, 1.5, 3.75]) {
    hslToLinearRgb(out, 0, h, 0.6, 0.4);
    assertBits(out, colorSetHSL(h, 0.6, 0.4));
  }
});

test('hslToLinearRgb matches Color.setHSL when saturation or lightness overflow [0, 1]', () => {
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

test('hslToLinearRgb matches Color.setHSL on NaN and infinities, each parameter in turn', () => {
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

test('hslToLinearRgb: zero saturation yields a grey of the lightness, like the reference', () => {
  const out = new Float64Array(3);
  hslToLinearRgb(out, 0, 0.77, 0, 0.33);
  assertBits(out, colorSetHSL(0.77, 0, 0.33));
  assert.equal(out[0], out[1]);
  assert.equal(out[1], out[2]);
});
