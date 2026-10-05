import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuaternion } from './quaternion.ts';
import { hypot4 } from '../primitives/hypot.ts';

const scaledBy = (q: number[], length: number) => q.map((v) => v / length);

test('a quaternion of ordinary size is divided by the root of its Kahan-summed squares', () => {
  // 1² + 2² + 3² + 4² = 30 exactly: the unscaled length is √30 rounded once.
  assert.deepEqual(
    Array.from(normalizeQuaternion(Float64Array.from([1, 2, 3, 4]))),
    scaledBy([1, 2, 3, 4], Math.sqrt(30)),
  );
  // Four equal tenths: the unit quaternion of halves, exactly.
  assert.deepEqual(
    Array.from(normalizeQuaternion(Float64Array.from([0.1, 0.1, 0.1, 0.1]))),
    [0.5, 0.5, 0.5, 0.5],
  );
});

test('zero, a NaN, an infinity and magnitudes near the limits keep the scaled length', () => {
  const cases = [
    [0, 0, 0, 0],
    [-0, 0, -0, 0],
    [NaN, 1, 0, 0],
    [Infinity, 1, 0, 0],
    [1e300, 1e300, 0, 0],
    [1e-200, 2e-200, 0, 3e-200],
    [2 ** -1074, 0, 0, 0],
  ];
  for (const q of cases) {
    const out = Array.from(normalizeQuaternion(Float64Array.from(q)));
    assert.deepEqual(out, scaledBy(q, hypot4(q[0], q[1], q[2], q[3]) || 1), String(q));
  }
});
