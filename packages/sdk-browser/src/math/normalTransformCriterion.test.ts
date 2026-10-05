// CRITERION for normal proofs, tested on manually chosen vectors without going through
// kernel. `angleBetween` and `normalVerdict` (`tests/gpu/math/inverseTransposeF32.ts`) decide if a
// rendered normal is correct: as long as they accept a reversed or lost normal, none of
// proofs relying on them — `normalTransform.test.ts` without GPU,
// `tests/gpu/math/normal-transform.gpu.ts` on real GPU — proves anything. That was
// the case: absolute value on dot product confused N and −N, and `atan2(0, 0) = 0`
// declared correct a normal that shader had lost.
//
// Separated from `normalTransform.test.ts` by responsibility: there kernel arithmetic, here
// instrument judging it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DROPOUT_DEG,
  angleBetween,
  NORM_TOLERANCE,
  normalVerdict,
  xformNormalModel,
} from '../../../../tests/gpu/math/inverseTransposeF32.ts';
import { TINY_REGULAR } from '../../../../tests/gpu/math/normalTransformCases.ts';

/** Verdict — oriented direction, zero vector rejected, unit norm — of a write on a case. */
const verdict = (cas: { truth: number[] }, rendue: number[]) =>
  normalVerdict(rendue, cas.truth, DROPOUT_DEG);

test('angleBetween/normalVerdict: ORIENTED direction, N and −N no longer confused (correctness)', () => {
  const N = [0, 0, 1];
  const moinsN = [0, 0, -1];
  assert.ok(Math.abs(angleBetween(N, N)) < 1e-12, 'two identical directions: null angle');
  assert.ok(
    Math.abs(angleBetween(N, moinsN) - Math.PI) < 1e-12,
    'two opposite directions: π, not 0 as under an absolute value of the dot product',
  );
  const oppose = verdict({ truth: N }, moinsN);
  assert.ok(!oppose.ok, 'a normal returned opposite the expected one must be refused');
  assert.ok(Math.abs(oppose.gapDeg - 180) < 1e-9, `gap ${oppose.gapDeg}°, expected 180°`);
});

test('angleBetween/normalVerdict: zero or non-finite vector yields NaN, never 0 (correctness)', () => {
  for (const v of [
    [0, 0, 0],
    [NaN, 0, 0],
    [Infinity, 0, 0],
    [0, -Infinity, 0],
  ])
    assert.ok(Number.isNaN(angleBetween(v, [0, 0, 1])), `angleBetween([${v}], N) must be NaN`);
  const rendueNulle = verdict({ truth: [0, 0, 1] }, [0, 0, 0]);
  assert.ok(!rendueNulle.ok, 'a null vector is refused, never accepted at 0°');
  assert.ok(Number.isNaN(rendueNulle.gapDeg), 'NaN gap, never 0° like atan2(0, 0)');
  assert.match(rendueNulle.reason ?? '', /no direction/, `reason: ${rendueNulle.reason}`);
});

test('normalVerdict: non-unit norm is rejected even in right direction (correctness)', () => {
  const tropCourte = verdict({ truth: [0, 0, 1] }, [0, 0, 0.9]);
  assert.ok(!tropCourte.ok, 'a non-unit normal must be refused, even if perfectly aligned');
  assert.match(tropCourte.reason ?? '', /not unit/, `unexpected reason: ${tropCourte.reason}`);
  const dansLaTolerance = verdict({ truth: [0, 0, 1] }, [0, 0, 1 + 1e-7]);
  assert.ok(dansLaTolerance.ok, `1e-7 under ${NORM_TOLERANCE}: must not be refused`);
});

test(
  'TINY_REGULAR: inverse-transpose computed by hand, independently of the kernel, yields ' +
    '[0.6 ; 0.8 ; 0] (geometric correctness)',
  () => {
    // diag(1e-8, −1e-8, −1e-8) is its own transpose; its inverse is diag(1e8, −1e8, −1e8).
    // Applied to local normal [0.6, −0.8, 0]: [0.6·1e8, −0.8·(−1e8), 0] = [6e7, 8e7, 0].
    // Plain double arithmetic, without `Math.fround` or `adjugateTimes`: this calculation reuses nothing
    // from tested kernel, serving as independent witness.
    const brut = [0.6 * 1e8, -0.8 * -1e8, 0];
    const norme = Math.hypot(brut[0], brut[1], brut[2]);
    const main = [brut[0] / norme, brut[1] / norme, brut[2] / norme];
    assert.deepEqual(
      main,
      [0.6, 0.8, 0],
      'the hand computation does not land on the expected value',
    );
    assert.deepEqual(TINY_REGULAR.truth, main, 'the witness departs from the hand value');
    const rendue = xformNormalModel(TINY_REGULAR.world, TINY_REGULAR.normal);
    const v = normalVerdict(rendue, main, DROPOUT_DEG);
    assert.ok(
      v.ok,
      `${TINY_REGULAR.name}: the kernel returns [${rendue}], instead of [${main}] — ${v.reason}`,
    );
  },
);
