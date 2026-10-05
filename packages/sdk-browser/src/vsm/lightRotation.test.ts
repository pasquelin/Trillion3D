// The world-to-light rotation of a direction (`vsmWorldToLightRotation`), built from the
// direction's own components: it takes the direction to +X, its rows are orthonormal and its
// light Y stays level, to the double's rounding; the world axes give exact matrices, a vertical
// direction takes world Y as its horizontal axis, and nothing translates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vsmNormalizeOrZero, vsmTransformPoint, vsmWorldToLightRotation } from './clipmap.ts';

const m = new Float64Array(16);
const ULPS = 8 * 2 ** -52;

test('the rotation takes the direction to +X, orthonormal and level, to a few ulps', () => {
  let seed = 3;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let k = 0; k < 20000; k++) {
    const tiny = k % 4 === 0 ? 10 ** (-15 * rnd()) : 1;
    const d = vsmNormalizeOrZero([tiny * (rnd() - 0.5), tiny * (rnd() - 0.5), rnd() - 0.5]);
    vsmWorldToLightRotation(m, d);
    const x = vsmTransformPoint(m, d[0], d[1], d[2]);
    assert.ok(Math.abs(x[0] - 1) < ULPS && Math.abs(x[1]) < ULPS && Math.abs(x[2]) < ULPS, `${d}`);
    for (let r = 0; r < 3; r++)
      for (let s = 0; s < 3; s++) {
        const dot = m[r] * m[s] + m[4 + r] * m[4 + s] + m[8 + r] * m[8 + s];
        assert.ok(Math.abs(dot - (r === s ? 1 : 0)) < ULPS, `rows ${r}, ${s} of ${d}`);
      }
    assert.equal(m[9], 0, 'the light Y has no world Z');
    assert.ok(m[10] >= 0, 'the light Z leans toward world +Z');
    for (const k of [3, 7, 11, 12, 13, 14]) assert.equal(m[k], 0);
    assert.equal(m[15], 1);
  }
});

test('the world axes give exact matrices: +X the identity, a vertical direction world Y level', () => {
  vsmWorldToLightRotation(m, [1, 0, 0]);
  assert.deepEqual([...m], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const z of [1, -1]) {
    vsmWorldToLightRotation(m, [0, 0, z]);
    // Rows: (0, 0, z), (0, 1, 0), (−z, 0, 0).
    assert.deepEqual([...m], [0, 0, -z, 0, 0, 1, 0, 0, z, 0, 0, 0, 0, 0, 0, 1]);
  }
  vsmWorldToLightRotation(m, [0, 1, 0]);
  assert.deepEqual([...m], [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});
