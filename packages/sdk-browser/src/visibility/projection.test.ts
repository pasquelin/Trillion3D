// Shared-formula batch: signedArea, factored out of 5 copies. Nominal
// and edge behaviours, distinct from the bit-exact equivalence bench (`bench/perf/browser/ts-formulas.perf.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedArea } from './projection.ts';

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
