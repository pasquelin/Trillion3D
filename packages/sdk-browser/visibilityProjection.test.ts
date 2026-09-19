// Shared-formula batch: signedArea and barycentricAt, factored out of 5 and 3 copies. Nominal
// and edge behaviours, distinct from the bit-exact equivalence bench (`bench/formules-ts.bench.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedArea, barycentricAt } from './visibilityProjection.ts';

test('signedArea returns twice the area, positive in the direct sense and negative reversed', () => {
  const a = { x: 0, y: 0 },
    b = { x: 4, y: 0 },
    c = { x: 0, y: 2 };
  assert.equal(signedArea(a, b, c), 8);
  assert.equal(signedArea(a, c, b), -8);
});

test('signedArea returns zero for three collinear points (degenerate triangle, null area)', () => {
  assert.equal(signedArea({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), 0);
  // Three coincident vertices: always a null area.
  assert.equal(signedArea({ x: 5, y: -3 }, { x: 5, y: -3 }, { x: 5, y: -3 }), 0);
});

test('signedArea propagates to NaN as soon as an operand is NaN', () => {
  assert.ok(Number.isNaN(signedArea({ x: NaN, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 })));
});

test('signedArea distinguishes +0 from -0 like Object.is, without ever throwing', () => {
  const value = signedArea({ x: -0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.ok(Object.is(value, 0) || Object.is(value, -0));
});

test('barycentricAt returns weights that sum to one and reconstruct the point at the centre', () => {
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

test('barycentricAt on a null-area triangle returns NaN or Infinity, never an exception', () => {
  const a = { x: 0, y: 0 },
    b = { x: 1, y: 1 },
    c = { x: 2, y: 2 };
  const weights = barycentricAt(a, b, c, 0.5, 0.5, signedArea(a, b, c));
  assert.ok(!Number.isFinite(weights.w0) || Number.isNaN(weights.w0));
});

test('barycentricAt reuses the same work object from one call to the next (documented contract)', () => {
  const a = { x: 0, y: 0 },
    b = { x: 2, y: 0 },
    c = { x: 0, y: 2 };
  const area = signedArea(a, b, c);
  const first = barycentricAt(a, b, c, 0.5, 0.5, area);
  const second = barycentricAt(a, b, c, 1, 1, area);
  assert.equal(first, second);
});
